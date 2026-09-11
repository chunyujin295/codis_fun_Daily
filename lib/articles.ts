import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  ARTICLE_MAX_BYTES,
  BASE_PATH,
  SITE_TIME_ZONE,
  SUMMARY_MAX_LENGTH,
} from '@/lib/constants';
import type { UploadPrincipal } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';
import { getDataRoot, getDb } from '@/lib/db';
import { processArticleHtml, type StoredMedia } from '@/lib/html';

export const articleInputSchema = z.object({
  schemaVersion: z.literal('1'),
  uploaderId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  externalId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(SUMMARY_MAX_LENGTH).default(''),
  category: z.string().trim().min(1).max(60),
  generatedAt: z.iso.datetime({ offset: true }),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  language: z.string().trim().min(2).max(20).default('zh-CN'),
  sourceUrl: z.url().startsWith('https://').optional(),
  html: z.string().min(1),
});

export type ArticleInput = z.infer<typeof articleInputSchema>;

export class ArticleError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
  }
}

type ExistingArticle = {
  id: string;
  slug: string;
  currentVersion: number;
  status: 'published';
};

export type ArticleSubmissionResult = {
  requestId: string;
  article: {
    id: string;
    slug: string;
    url: string;
    version: number;
    contentDate: string;
    category: string;
    contentHash: string;
    status: 'published';
    audioStatus: 'queued' | 'unavailable';
  };
  replayed?: boolean;
};

export function assertUploadPrincipal(
  input: ArticleInput,
  principal: UploadPrincipal | undefined,
) {
  if (!principal) return;
  if (input.uploaderId !== principal.uploaderId) {
    throw new ArticleError('UPLOADER_MISMATCH', 403);
  }
  // 栏目不再按令牌限制（2026-09-11 起）：只要是站点已启用的栏目都可以发布。
  // 之前这里会校验 principal.allowedCategories，导致令牌必须逐个授权栏目。
  // 栏目本身是否启用仍会在下面校验（未启用 → UNKNOWN_CATEGORY）。
}

function getContentDate(generatedAt: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(generatedAt));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function slugPart(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function makeSlug(
  contentDate: string,
  category: string,
  externalId: string,
  uploaderId: string,
) {
  const external = slugPart(externalId) || randomUUID().slice(0, 12);
  return `${contentDate}-${slugPart(category)}-${slugPart(uploaderId)}-${external}`;
}

function ensureUniqueSlug(candidate: string) {
  const db = getDb();
  let slug = candidate;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM articles WHERE slug = ?').get(slug)) {
    suffix += 1;
    slug = `${candidate}-${suffix}`;
  }
  return slug;
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.normalize('NFKC').toLocaleLowerCase('zh-CN');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function submitArticle(
  rawInput: unknown,
  idempotencyKey: string,
  options: {
    expectedExternalId?: string;
    principal?: UploadPrincipal;
  } = {},
): Promise<ArticleSubmissionResult> {
  const parsed = articleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ArticleError(
      'INVALID_ARTICLE',
      422,
      parsed.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  const input = { ...parsed.data, tags: normalizeTags(parsed.data.tags) };
  assertUploadPrincipal(input, options.principal);
  if (Buffer.byteLength(input.html, 'utf8') > ARTICLE_MAX_BYTES) {
    throw new ArticleError('ARTICLE_TOO_LARGE', 413);
  }
  if (
    options.expectedExternalId &&
    input.externalId !== options.expectedExternalId
  ) {
    throw new ArticleError('EXTERNAL_ID_MISMATCH', 409);
  }
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new ArticleError('INVALID_IDEMPOTENCY_KEY', 422);
  }

  const db = getDb();
  const requestHash = sha256(JSON.stringify(input));
  const idempotent = db
    .prepare(`
      SELECT request_hash AS requestHash, response_json AS responseJson
      FROM idempotency_records WHERE uploader_id = ? AND idempotency_key = ?
    `)
    .get(input.uploaderId, idempotencyKey) as
    | { requestHash: string; responseJson: string }
    | undefined;
  if (idempotent) {
    if (idempotent.requestHash !== requestHash) {
      throw new ArticleError('IDEMPOTENCY_CONFLICT', 409);
    }
    return {
      ...(JSON.parse(idempotent.responseJson) as ArticleSubmissionResult),
      replayed: true,
    };
  }

  const category = db
    .prepare('SELECT slug FROM categories WHERE slug = ? AND enabled = 1')
    .get(input.category);
  if (!category) throw new ArticleError('UNKNOWN_CATEGORY', 422);

  let processed;
  try {
    processed = await processArticleHtml(input.html);
  } catch (error) {
    const code =
      error instanceof Error ? error.message : 'HTML_PROCESSING_FAILED';
    const status =
      code.startsWith('IMAGE_') || code.includes('IMAGES') ? 424 : 422;
    throw new ArticleError(code, status);
  }

  const now = new Date().toISOString();
  const contentDate = getContentDate(input.generatedAt);
  const requestId = randomUUID();

  return db.transaction(() => {
    const existing = db
      .prepare(`
        SELECT id, slug, current_version AS currentVersion, status
        FROM articles WHERE uploader_id = ? AND external_id = ?
      `)
      .get(input.uploaderId, input.externalId) as ExistingArticle | undefined;

    const articleId = existing?.id ?? randomUUID();
    const version = (existing?.currentVersion ?? 0) + 1;
    const slug =
      existing?.slug ??
      ensureUniqueSlug(
        makeSlug(contentDate, input.category, input.externalId, input.uploaderId),
      );
    const status = existing?.status ?? 'published';

    db.prepare(`
      INSERT INTO uploaders(id, display_name, enabled, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `).run(input.uploaderId, input.uploaderId, now, now);

    if (existing) {
      db.prepare(`
        UPDATE articles
        SET current_version = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(version, status, now, articleId);
    } else {
      db.prepare(`
        INSERT INTO articles(
          id, external_id, slug, uploader_id, current_version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        articleId,
        input.externalId,
        slug,
        input.uploaderId,
        version,
        status,
        now,
        now,
      );
    }

    const articleVersionId = randomUUID();
    db.prepare(`
      INSERT INTO article_versions(
        id, article_id, version, title, summary, category_slug, generated_at,
        content_date, received_at, published_at, language, source_url, tags_json,
        sanitized_html, extracted_text, raw_content_hash, sanitized_content_hash,
        sanitizer_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1', ?)
    `).run(
      articleVersionId,
      articleId,
      version,
      input.title,
      input.summary,
      input.category,
      input.generatedAt,
      contentDate,
      now,
      now,
      input.language,
      input.sourceUrl ?? null,
      JSON.stringify(input.tags),
      processed.html,
      processed.extractedText,
      sha256(input.html),
      processed.sanitizedHash,
      now,
    );

    const insertMedia = db.prepare(`
      INSERT INTO media_blobs(hash, relative_path, mime_type, byte_size, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hash) DO NOTHING
    `);
    const linkMedia = db.prepare(`
      INSERT INTO article_version_media(article_version_id, media_hash, source_host, position)
      VALUES (?, ?, ?, ?)
    `);
    for (const media of processed.media as StoredMedia[]) {
      insertMedia.run(
        media.hash,
        '',  // base64 内嵌，无文件路径
        media.mimeType,
        media.byteSize,
        media.width,
        media.height,
        now,
      );
      linkMedia.run(
        articleVersionId,
        media.hash,
        media.sourceHost,
        media.position,
      );
    }

    const provider = db
      .prepare(`
        SELECT id FROM tts_provider_configs
        WHERE enabled = 1 AND app_id_encrypted IS NOT NULL
          AND api_key_encrypted IS NOT NULL AND api_secret_encrypted IS NOT NULL
        LIMIT 1
      `)
      .get() as { id: string } | undefined;
    const audioStatus = provider ? 'queued' : 'unavailable';
    if (provider) {
      db.prepare(`
        INSERT INTO tts_jobs(
          id, article_version_id, provider_config_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'QUEUED', ?, ?)
      `).run(randomUUID(), articleVersionId, provider.id, now, now);
    }

    const expiredVersions = db
      .prepare(
        'SELECT id FROM article_versions WHERE article_id = ? AND version < ?',
      )
      .all(articleId, Math.max(1, version - 1)) as { id: string }[];
    for (const expired of expiredVersions) {
      db.prepare('DELETE FROM article_versions WHERE id = ?').run(expired.id);
    }

    const result: ArticleSubmissionResult = {
      requestId,
      article: {
        id: articleId,
        slug,
        url: `${BASE_PATH}/articles/${slug}`,
        version,
        contentDate,
        category: input.category,
        contentHash: processed.sanitizedHash,
        status,
        audioStatus,
      },
    };
    db.prepare(`
      INSERT INTO idempotency_records(
        uploader_id, idempotency_key, request_hash, response_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      input.uploaderId,
      idempotencyKey,
      requestHash,
      JSON.stringify(result),
      now,
    );
    db.prepare(`
      INSERT INTO upload_audits(
        request_id, uploader_id_claim, article_id, version, result,
        content_length, created_at
      ) VALUES (?, ?, ?, ?, 'SUCCESS', ?, ?)
    `).run(
      requestId,
      input.uploaderId,
      articleId,
      version,
      Buffer.byteLength(input.html, 'utf8'),
      now,
    );
    return result;
  })();
}

type TimelineRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  categoryName: string;
  color: string;
  generatedAt: string;
  contentDate: string;
  uploaderId: string;
  tagsJson: string;
  audioStatus: string | null;
};

export function getTimelineRows() {
  return getDb()
    .prepare(`
      SELECT a.id, a.slug, v.title, v.summary, v.category_slug AS category,
        c.name AS categoryName, c.color, v.generated_at AS generatedAt,
        v.content_date AS contentDate, a.uploader_id AS uploaderId,
        v.tags_json AS tagsJson, j.status AS audioStatus
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      JOIN categories c ON c.slug = v.category_slug
      LEFT JOIN tts_jobs j ON j.article_version_id = v.id
      WHERE a.status = 'published' AND c.enabled = 1
      ORDER BY v.content_date DESC, c.sort_order ASC, v.generated_at DESC, a.id DESC
      LIMIT 240
    `)
    .all() as TimelineRow[];
}

export function getArticleBySlug(slug: string, includeArchived = false) {
  const row = getDb()
    .prepare(`
      SELECT a.id, a.slug, a.status, a.uploader_id AS uploaderId,
        a.current_version AS version, v.id AS versionId, v.title, v.summary,
        v.category_slug AS category, c.name AS categoryName, c.color,
        v.generated_at AS generatedAt, v.content_date AS contentDate,
        v.published_at AS publishedAt, v.tags_json AS tagsJson,
        v.sanitized_html AS html, v.extracted_text AS extractedText,
        COALESCE(j.status, 'UNAVAILABLE') AS audioStatus,
        aa.duration_ms AS audioDurationMs
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      JOIN categories c ON c.slug = v.category_slug
      LEFT JOIN tts_jobs j ON j.article_version_id = v.id
      LEFT JOIN audio_assets aa ON aa.article_version_id = v.id
      WHERE a.slug = ? ${includeArchived ? '' : "AND a.status = 'published'"}
    `)
    .get(slug) as
    | (TimelineRow & {
        status: string;
        version: number;
        versionId: string;
        categoryName: string;
        publishedAt: string;
        html: string;
        extractedText: string;
        audioDurationMs: number | null;
      })
    | undefined;
  return row;
}

export function getCategories() {
  return getDb()
    .prepare(`
      SELECT slug, name, color, sort_order AS sortOrder, enabled
      FROM categories ORDER BY sort_order, name
    `)
    .all() as {
    slug: string;
    name: string;
    color: string;
    sortOrder: number;
    enabled: number;
  }[];
}

export function getAdminArticles() {
  return getDb()
    .prepare(`
      SELECT a.id, a.slug, a.external_id AS externalId, a.uploader_id AS uploaderId,
        a.status, a.current_version AS version, a.updated_at AS updatedAt,
        v.title, v.category_slug AS category, v.generated_at AS generatedAt,
        COALESCE(j.status, 'UNAVAILABLE') AS audioStatus
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      LEFT JOIN tts_jobs j ON j.article_version_id = v.id
      ORDER BY a.updated_at DESC LIMIT 250
    `)
    .all() as {
    id: string;
    slug: string;
    externalId: string;
    uploaderId: string;
    status: string;
    version: number;
    updatedAt: string;
    title: string;
    category: string;
    generatedAt: string;
    audioStatus: string;
  }[];
}

/**
 * 彻底删除一篇文章：数据库里不留任何关联记录，并清理磁盘上的音频文件。
 *
 * 删除顺序（外键已开启，tts_jobs / audio_assets 会随版本级联删除）：
 *   1. article_version_media（版本与媒体的关联）
 *   2. article_versions（级联带走 tts_jobs、audio_assets）
 *   3. articles
 *   4. media_blobs 中已无任何版本引用的孤儿记录
 * 最后删除音频文件（图片不落盘，只存 data URI，所以没有图片文件要删）。
 */
export async function deleteArticle(articleId: string) {
  const db = getDb();
  const article = db
    .prepare('SELECT id FROM articles WHERE id = ?')
    .get(articleId) as { id: string } | undefined;
  if (!article) return false;

  const audioAssets = db
    .prepare(
      `SELECT relative_path AS relativePath FROM audio_assets
       WHERE article_version_id IN (SELECT id FROM article_versions WHERE article_id = ?)`,
    )
    .all(articleId) as { relativePath: string }[];

  db.transaction(() => {
    db.prepare(
      `DELETE FROM article_version_media WHERE article_version_id IN
       (SELECT id FROM article_versions WHERE article_id = ?)`,
    ).run(articleId);
    db.prepare('DELETE FROM article_versions WHERE article_id = ?').run(
      articleId,
    );
    db.prepare('DELETE FROM articles WHERE id = ?').run(articleId);
    // 清理不再被任何文章版本引用的媒体记录（media_blobs 按内容哈希共享，
    // 只删没有引用的，避免误删其他文章还在用的图）
    db.prepare(
      `DELETE FROM media_blobs
       WHERE hash NOT IN (SELECT media_hash FROM article_version_media)`,
    ).run();
  })();

  await Promise.allSettled(
    audioAssets
      .filter((asset) => asset.relativePath)
      .map((asset) => unlink(path.join(getDataRoot(), asset.relativePath))),
  );
  return true;
}

export function getOverview() {
  const db = getDb();
  const articleCounts = db
    .prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
      FROM articles
    `)
    .get() as { total: number; published: number };
  const ttsCounts = db
    .prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
      FROM tts_jobs
    `)
    .get() as { total: number; ready: number; failed: number };
  return { articleCounts, ttsCounts };
}
