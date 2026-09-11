import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { AUDIO_MAX_BYTES, BASE_PATH } from '@/lib/constants';
import { sha256 } from '@/lib/crypto';
import { getDataRoot, getDb } from '@/lib/db';
import { getRequestIp, verifyUploadRequest } from '@/lib/auth';
import { estimateMp3DurationMs } from '@/lib/mp3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 查询某篇文章当前版本的音频状态（path 参数是文章内部 id） */
export async function GET(
  _request: Request,
  context: { params: Promise<{ externalId: string }> },
) {
  const { externalId: articleId } = await context.params;
  const row = getDb()
    .prepare(`
      SELECT COALESCE(j.status, 'UNAVAILABLE') AS status,
        aa.duration_ms AS durationMs
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      LEFT JOIN tts_jobs j ON j.article_version_id = v.id
      LEFT JOIN audio_assets aa ON aa.article_version_id = v.id
      WHERE a.id = ? AND a.status = 'published'
    `)
    .get(articleId) as
    | { status: string; durationMs: number | null }
    | undefined;
  if (!row) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    {
      status: row.status,
      durationMs: row.durationMs,
      streamUrl:
        row.status === 'READY'
          ? `${BASE_PATH}/api/v1/articles/${articleId}/audio/stream`
          : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * 智能体上传朗读音频（MP3），由智能体直接提供口播语音。
 *
 * - 鉴权与文章上传一致（Bearer 独立令牌）。
 * - 音频必须挂在**该令牌自己的**文章上（按 external_id + uploader_id 定位），
 *   所以不能用 legacy 共享密码（那没有上传者身份）。
 * - 请求体就是 MP3 的原始字节（Content-Type: audio/mpeg），不要用 multipart。
 * - 入库时同步 upsert 一条 status='READY' 的 tts_jobs 记录（幂等覆盖），这样既有的
 *   GET /audio 与 /audio/stream（它们 JOIN tts_jobs）无需任何改动就能读到。
 * - 响应里的 streamUrl 必须用**文章内部 id（UUID）**拼 —— 公开的 GET /audio 与
 *   /audio/stream 是按 `a.id` 寻址的，用 externalId（slug）拼会 404。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ externalId: string }> },
) {
  const auth = verifyUploadRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code } },
      { status: auth.status },
    );
  }
  // legacy 共享密码没有上传者身份，无法校验"音频只能挂在自己的文章上"
  if (auth.mode !== 'token' || !auth.principal) {
    return NextResponse.json(
      { error: { code: 'TOKEN_REQUIRED' } },
      { status: 401 },
    );
  }
  const principal = auth.principal;
  const { externalId } = await context.params;
  const requestId = randomUUID();

  try {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json(
        { error: { code: 'EMPTY_AUDIO' } },
        { status: 400 },
      );
    }
    if (body.byteLength > AUDIO_MAX_BYTES) {
      return NextResponse.json(
        { error: { code: 'AUDIO_TOO_LARGE' } },
        { status: 413 },
      );
    }

    // 轻量校验：MP3 要么有 ID3 标签头，要么以 MPEG 帧同步字节开头
    const head = new Uint8Array(body.slice(0, 3));
    const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const isMpeg = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    if (!isId3 && !isMpeg) {
      return NextResponse.json(
        { error: { code: 'AUDIO_FORMAT_NOT_SUPPORTED' } },
        { status: 415 },
      );
    }

    const db = getDb();
    const article = db
      .prepare(`
        SELECT a.id AS articleId, v.id AS versionId
        FROM articles a
        JOIN article_versions v
          ON v.article_id = a.id AND v.version = a.current_version
        WHERE a.external_id = ? AND a.uploader_id = ? AND a.status = 'published'
      `)
      .get(externalId, principal.uploaderId) as
      | { articleId: string; versionId: string }
      | undefined;
    if (!article) {
      return NextResponse.json(
        { error: { code: 'ARTICLE_NOT_FOUND' } },
        { status: 404 },
      );
    }

    const bytes = Buffer.from(body);
    const hash = sha256(bytes);
    const durationMs = estimateMp3DurationMs(bytes);
    const relativePath = path.join(
      'audio',
      'sha256',
      hash.slice(0, 2),
      `${hash}.mp3`,
    );
    const finalPath = path.join(getDataRoot(), relativePath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await access(finalPath); // 内容寻址：同一段音频已存在就复用
    } catch {
      await writeFile(finalPath, bytes, { flag: 'wx' }); // 并发同内容时后到者抛 EEXIST，可忽略
    }

    const now = new Date().toISOString();
    const jobId = randomUUID();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tts_jobs(
          id, article_version_id, provider_config_id, status, attempt_count,
          created_at, updated_at
        ) VALUES (?, ?, NULL, 'READY', 0, ?, ?)
        ON CONFLICT(article_version_id) DO UPDATE SET
          status = 'READY', safe_error_code = NULL, safe_error_message = NULL,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = excluded.updated_at
      `).run(jobId, article.versionId, now, now);
      db.prepare(`
        INSERT INTO audio_assets(
          article_version_id, tts_job_id, relative_path, mime_type,
          byte_size, hash, duration_ms, created_at
        ) VALUES (?, ?, ?, 'audio/mpeg', ?, ?, ?, ?)
        ON CONFLICT(article_version_id) DO UPDATE SET
          tts_job_id = excluded.tts_job_id, relative_path = excluded.relative_path,
          byte_size = excluded.byte_size, hash = excluded.hash,
          duration_ms = excluded.duration_ms, created_at = excluded.created_at
      `).run(
        article.versionId,
        jobId,
        relativePath,
        bytes.length,
        hash,
        durationMs,
        now,
      );
    })();

    return NextResponse.json(
      {
        ok: true,
        status: 'READY',
        byteSize: bytes.length,
        durationMs,
        streamUrl: `${BASE_PATH}/api/v1/articles/${article.articleId}/audio/stream`,
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.name : 'UNKNOWN';
    try {
      getDb()
        .prepare(`
          INSERT INTO upload_audits(
            request_id, result, error_code, content_length, ip_digest, created_at
          ) VALUES (?, 'FAILED', ?, ?, ?, ?)
        `)
        .run(
          requestId,
          code,
          request.headers.get('content-length') ?? null,
          sha256(getRequestIp(request)),
          new Date().toISOString(),
        );
    } catch {
      // 审计写入失败不掩盖原始错误
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', requestId } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

