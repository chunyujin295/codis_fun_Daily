import { createHmac, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

import { estimateMp3DurationMs } from '@/lib/mp3';
import { z } from 'zod';

import { XFYUN_SEGMENT_MAX_BYTES } from '@/lib/constants';
import { decryptSecret, encryptSecret, sha256 } from '@/lib/crypto';
import { getDataRoot, getDb } from '@/lib/db';

const configSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().trim().min(1).max(80).default('科大讯飞在线语音合成'),
  appId: z.string().trim().min(1).max(128).optional(),
  apiKey: z.string().trim().min(1).max(256).optional(),
  apiSecret: z.string().trim().min(1).max(256).optional(),
  vcn: z.string().trim().min(1).max(80).default('x4_xiaoyan'),
  speed: z.number().int().min(0).max(100).default(50),
  volume: z.number().int().min(0).max(100).default(50),
  pitch: z.number().int().min(0).max(100).default(50),
});

type ProviderRow = {
  id: string;
  displayName: string;
  enabled: number;
  appIdEncrypted: string | null;
  apiKeyEncrypted: string | null;
  apiSecretEncrypted: string | null;
  vcn: string;
  speed: number;
  volume: number;
  pitch: number;
  credentialRevision: number;
  profileRevision: number;
  lastTestStatus: string | null;
  lastTestAt: string | null;
};

type XfyunSecrets = { appId: string; apiKey: string; apiSecret: string };

function getProviderRow() {
  return getDb()
    .prepare(`
      SELECT id, display_name AS displayName, enabled,
        app_id_encrypted AS appIdEncrypted,
        api_key_encrypted AS apiKeyEncrypted,
        api_secret_encrypted AS apiSecretEncrypted,
        vcn, speed, volume, pitch,
        credential_revision AS credentialRevision,
        profile_revision AS profileRevision,
        last_test_status AS lastTestStatus,
        last_test_at AS lastTestAt
      FROM tts_provider_configs WHERE id = 'xfyun-default'
    `)
    .get() as ProviderRow;
}

export function getTtsAdminConfig() {
  const row = getProviderRow();
  return {
    id: row.id,
    adapterType: 'xfyun-online-ws-v2',
    endpoint: 'wss://tts-api.xfyun.cn/v2/tts',
    displayName: row.displayName,
    enabled: Boolean(row.enabled),
    hasAppId: Boolean(row.appIdEncrypted),
    hasApiKey: Boolean(row.apiKeyEncrypted),
    hasApiSecret: Boolean(row.apiSecretEncrypted),
    vcn: row.vcn,
    speed: row.speed,
    volume: row.volume,
    pitch: row.pitch,
    credentialRevision: row.credentialRevision,
    profileRevision: row.profileRevision,
    lastTestStatus: row.lastTestStatus,
    lastTestAt: row.lastTestAt,
  };
}

export function saveTtsConfig(raw: unknown) {
  const parsed = configSchema.parse(raw);
  const current = getProviderRow();
  const credentialChanged = Boolean(
    parsed.appId || parsed.apiKey || parsed.apiSecret,
  );
  const profileChanged =
    parsed.vcn !== current.vcn ||
    parsed.speed !== current.speed ||
    parsed.volume !== current.volume ||
    parsed.pitch !== current.pitch;
  const requiresTest =
    credentialChanged || profileChanged || current.lastTestStatus !== 'SUCCESS';
  const appIdEncrypted = parsed.appId
    ? encryptSecret(parsed.appId, 'xfyun-default:appId')
    : current.appIdEncrypted;
  const apiKeyEncrypted = parsed.apiKey
    ? encryptSecret(parsed.apiKey, 'xfyun-default:apiKey')
    : current.apiKeyEncrypted;
  const apiSecretEncrypted = parsed.apiSecret
    ? encryptSecret(parsed.apiSecret, 'xfyun-default:apiSecret')
    : current.apiSecretEncrypted;
  if (
    parsed.enabled &&
    (!appIdEncrypted || !apiKeyEncrypted || !apiSecretEncrypted)
  ) {
    throw new Error('XFYUN_CREDENTIALS_REQUIRED');
  }
  const effectiveEnabled = parsed.enabled && !requiresTest;

  getDb()
    .prepare(`
      UPDATE tts_provider_configs SET
        display_name = ?, enabled = ?, app_id_encrypted = ?, api_key_encrypted = ?,
        api_secret_encrypted = ?, vcn = ?, speed = ?, volume = ?, pitch = ?,
        credential_revision = ?, profile_revision = ?, last_test_status = ?, updated_at = ?
      WHERE id = 'xfyun-default'
    `)
    .run(
      parsed.displayName,
      effectiveEnabled ? 1 : 0,
      appIdEncrypted,
      apiKeyEncrypted,
      apiSecretEncrypted,
      parsed.vcn,
      parsed.speed,
      parsed.volume,
      parsed.pitch,
      current.credentialRevision + (credentialChanged ? 1 : 0),
      current.profileRevision + (profileChanged ? 1 : 0),
      credentialChanged || profileChanged ? null : current.lastTestStatus,
      new Date().toISOString(),
    );
  return getTtsAdminConfig();
}

function decryptProviderSecrets(row: ProviderRow): XfyunSecrets {
  if (!row.appIdEncrypted || !row.apiKeyEncrypted || !row.apiSecretEncrypted) {
    throw new Error('XFYUN_CREDENTIALS_REQUIRED');
  }
  return {
    appId: decryptSecret(row.appIdEncrypted, 'xfyun-default:appId'),
    apiKey: decryptSecret(row.apiKeyEncrypted, 'xfyun-default:apiKey'),
    apiSecret: decryptSecret(row.apiSecretEncrypted, 'xfyun-default:apiSecret'),
  };
}

export function createXfyunSignedUrl(
  apiKey: string,
  apiSecret: string,
  now = new Date(),
) {
  const host = 'tts-api.xfyun.cn';
  const route = '/v2/tts';
  const date = now.toUTCString();
  const canonical = `host: ${host}\ndate: ${date}\nGET ${route} HTTP/1.1`;
  const signature = createHmac('sha256', apiSecret)
    .update(canonical)
    .digest('base64');
  const authorization = Buffer.from(
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`,
    'utf8',
  ).toString('base64');
  const params = new URLSearchParams({ host, date, authorization });
  return `wss://${host}${route}?${params.toString()}`;
}

export function segmentText(text: string, maxBytes = XFYUN_SEGMENT_MAX_BYTES) {
  const normalized = text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[。！？；\n])/u).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };
  const append = (value: string) => {
    if (Buffer.byteLength(current + value, 'utf8') < maxBytes) {
      current += value;
      return;
    }
    flush();
    if (Buffer.byteLength(value, 'utf8') < maxBytes) {
      current = value;
      return;
    }
    for (const character of value) {
      if (Buffer.byteLength(current + character, 'utf8') >= maxBytes) flush();
      current += character;
    }
  };
  for (const sentence of sentences) append(sentence);
  flush();
  return chunks;
}

class XfyunResponseError extends Error {
  constructor(
    public vendorCode: number,
    public providerSid: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function synthesizeXfyunChunk(
  text: string,
  provider: ProviderRow,
  secrets: XfyunSecrets,
) {
  const signedUrl = createXfyunSignedUrl(secrets.apiKey, secrets.apiSecret);
  return new Promise<Buffer>((resolve, reject) => {
    const socket = new WebSocket(signedUrl, { handshakeTimeout: 8_000 });
    const audio: Buffer[] = [];
    let settled = false;
    let sid: string | undefined;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('XFYUN_TIMEOUT'));
    }, 45_000);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          common: { app_id: secrets.appId },
          business: {
            aue: 'raw',
            auf: 'audio/L16;rate=16000',
            vcn: provider.vcn,
            speed: provider.speed,
            volume: provider.volume,
            pitch: provider.pitch,
            bgs: 0,
            tte: 'UTF8',
            reg: '0',
            rdn: '0',
          },
          data: {
            status: 2,
            text: Buffer.from(text, 'utf8').toString('base64'),
          },
        }),
      );
    });

    socket.on('message', (payload, isBinary) => {
      if (isBinary) {
        finish(() => reject(new Error('XFYUN_UNEXPECTED_BINARY_FRAME')));
        socket.terminate();
        return;
      }
      try {
        const messageText = Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : Array.isArray(payload)
            ? Buffer.concat(payload).toString('utf8')
            : Buffer.from(payload).toString('utf8');
        const message = JSON.parse(messageText) as {
          code: number;
          message?: string;
          sid?: string;
          data?: { audio?: string; status?: number } | null;
        };
        sid ??= message.sid;
        if (message.code !== 0) {
          finish(() =>
            reject(
              new XfyunResponseError(
                message.code,
                sid,
                message.message ?? 'XFYUN_ERROR',
              ),
            ),
          );
          socket.close(1000);
          return;
        }
        if (!message.data) return;
        if (message.data.audio) {
          if (
            message.data.audio.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data.audio)
          ) {
            throw new Error('XFYUN_INVALID_BASE64_AUDIO');
          }
          audio.push(Buffer.from(message.data.audio, 'base64'));
        }
        if (message.data.status === 2) {
          const result = Buffer.concat(audio);
          if (!result.length) throw new Error('XFYUN_EMPTY_AUDIO');
          finish(() => resolve(result));
          socket.close(1000);
        }
      } catch (error) {
        finish(() => reject(error));
        socket.terminate();
      }
    });
    socket.on('error', (error) => finish(() => reject(error)));
    socket.on('close', () => {
      if (!settled) finish(() => reject(new Error('XFYUN_EARLY_CLOSE')));
    });
  });
}

async function encodeMp3(pcmPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      /* turbopackIgnore: true */ process.env.FFMPEG_PATH ?? 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        's16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-i',
        pcmPath,
        '-codec:a',
        'libmp3lame',
        '-q:a',
        '4',
        '-y',
        outputPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (value: Buffer) => {
      stderr += String(value).slice(0, 1_000);
    });
    child.on('error', () => reject(new Error('FFMPEG_UNAVAILABLE')));
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(stderr ? 'FFMPEG_FAILED' : 'FFMPEG_FAILED'));
    });
  });
}

function isRetryable(error: unknown) {
  if (error instanceof XfyunResponseError) {
    return [10010, 10110, 10118, 10221, 11202, 11203, 11502, 11503].includes(
      error.vendorCode,
    );
  }
  const code = error instanceof Error ? error.message : '';
  return ['XFYUN_TIMEOUT', 'XFYUN_EARLY_CLOSE'].includes(code);
}

export async function testXfyunProvider() {
  const provider = getProviderRow();
  const secrets = decryptProviderSecrets(provider);
  try {
    await synthesizeXfyunChunk('欢迎来到 Daily Paper。', provider, secrets);
    const now = new Date().toISOString();
    getDb()
      .prepare(`
        UPDATE tts_provider_configs
        SET last_test_status = 'SUCCESS', last_test_at = ?, updated_at = ?
        WHERE id = 'xfyun-default'
      `)
      .run(now, now);
    return { status: 'SUCCESS', testedAt: now };
  } catch (error) {
    const now = new Date().toISOString();
    getDb()
      .prepare(`
        UPDATE tts_provider_configs
        SET enabled = 0, last_test_status = 'FAILED', last_test_at = ?, updated_at = ?
        WHERE id = 'xfyun-default'
      `)
      .run(now, now);
    throw error;
  }
}

export async function processNextTtsJob(workerId = `worker-${process.pid}`) {
  const db = getDb();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const job = db.transaction(() => {
    const candidate = db
      .prepare(`
        SELECT id FROM tts_jobs
        WHERE status IN ('QUEUED', 'RETRY_WAIT')
          AND (lease_expires_at IS NULL OR lease_expires_at < ?)
        ORDER BY created_at LIMIT 1
      `)
      .get(now.toISOString()) as { id: string } | undefined;
    if (!candidate) return null;
    db.prepare(`
      UPDATE tts_jobs SET status = 'SYNTHESIZING', lease_owner = ?,
        lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
      WHERE id = ?
    `).run(workerId, leaseUntil, now.toISOString(), candidate.id);
    return candidate;
  })();
  if (!job) return false;

  try {
    const details = db
      .prepare(`
        SELECT j.id, j.article_version_id AS versionId, j.attempt_count AS attempts,
          v.extracted_text AS text, a.status AS articleStatus, p.*
        FROM tts_jobs j
        JOIN article_versions v ON v.id = j.article_version_id
        JOIN articles a ON a.id = v.article_id
        JOIN tts_provider_configs p ON p.id = j.provider_config_id
        WHERE j.id = ?
      `)
      .get(job.id) as Record<string, unknown> & {
      id: string;
      versionId: string;
      attempts: number;
      text: string;
      articleStatus: string;
    };
    if (details.articleStatus !== 'published')
      throw new Error('ARTICLE_ARCHIVED');
    const provider = getProviderRow();
    const secrets = decryptProviderSecrets(provider);
    const chunks = segmentText(details.text);
    if (!chunks.length) throw new Error('NO_READABLE_TEXT');
    const audioChunks: Buffer[] = [];
    for (const chunk of chunks) {
      audioChunks.push(await synthesizeXfyunChunk(chunk, provider, secrets));
    }

    const temporaryRoot = path.join(getDataRoot(), 'tmp');
    await fs.mkdir(temporaryRoot, { recursive: true });
    const temporaryBase = path.join(temporaryRoot, randomUUID());
    const pcmPath = `${temporaryBase}.pcm`;
    const mp3Path = `${temporaryBase}.mp3`;
    await fs.writeFile(pcmPath, Buffer.concat(audioChunks), { flag: 'wx' });
    await encodeMp3(pcmPath, mp3Path);
    const mp3 = await fs.readFile(mp3Path);
    const hash = sha256(mp3);
    const relativePath = path.join(
      'audio',
      'sha256',
      hash.slice(0, 2),
      `${hash}.mp3`,
    );
    const finalPath = path.join(getDataRoot(), relativePath);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await fs.access(finalPath);
    } catch {
      await fs.rename(mp3Path, finalPath);
    }
    await Promise.allSettled([fs.unlink(pcmPath), fs.unlink(mp3Path)]);

    const durationMs = estimateMp3DurationMs(await fs.readFile(finalPath));

    db.transaction(() => {
      const current = db
        .prepare(`
          SELECT 1 FROM articles a JOIN article_versions v
            ON v.article_id = a.id AND v.version = a.current_version
          WHERE v.id = ?
        `)
        .get(details.versionId);
      if (!current) {
        db.prepare(
          `UPDATE tts_jobs SET status = 'SUPERSEDED', updated_at = ? WHERE id = ?`,
        ).run(new Date().toISOString(), job.id);
        return;
      }
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
        details.versionId,
        job.id,
        relativePath,
        mp3.length,
        hash,
        durationMs,
        new Date().toISOString(),
      );
      db.prepare(`
        UPDATE tts_jobs SET status = 'READY', safe_error_code = NULL,
          safe_error_message = NULL, lease_owner = NULL, lease_expires_at = NULL,
          updated_at = ? WHERE id = ?
      `).run(new Date().toISOString(), job.id);
    })();
  } catch (error) {
    const errorCode =
      error instanceof XfyunResponseError
        ? `XFYUN_${error.vendorCode}`
        : error instanceof Error
          ? error.message
          : 'TTS_FAILED';
    const row = db
      .prepare('SELECT attempt_count AS attempts FROM tts_jobs WHERE id = ?')
      .get(job.id) as { attempts: number };
    const retry = isRetryable(error) && row.attempts < 3;
    db.prepare(`
      UPDATE tts_jobs SET status = ?, safe_error_code = ?,
        safe_error_message = ?, lease_owner = NULL, lease_expires_at = NULL,
        updated_at = ? WHERE id = ?
    `).run(
      retry ? 'RETRY_WAIT' : 'FAILED',
      errorCode,
      retry ? '供应商暂时不可用，将自动重试' : '语音生成失败，请在后台检查配置',
      new Date().toISOString(),
      job.id,
    );
  }
  return true;
}
