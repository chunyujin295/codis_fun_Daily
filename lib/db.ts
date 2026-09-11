import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { hashPassword } from '@/lib/crypto';

const dataRoot = path.resolve(
  /* turbopackIgnore: true */ process.env.DATA_DIR ??
    path.join(process.cwd(), 'data'),
);
const databasePath = path.resolve(
  /* turbopackIgnore: true */ process.env.DATABASE_PATH ??
    path.join(dataRoot, 'daily-knowledge.db'),
);

mkdirSync(path.dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & {
  dailyKnowledgeDb?: Database.Database;
};

function createDatabase() {
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaders (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_tokens (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL REFERENCES uploaders(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      token_secret TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS upload_token_categories (
      token_id TEXT NOT NULL REFERENCES upload_tokens(id) ON DELETE CASCADE,
      category_slug TEXT NOT NULL REFERENCES categories(slug),
      PRIMARY KEY(token_id, category_slug)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      uploader_id TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status = 'published'),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(uploader_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS article_versions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category_slug TEXT NOT NULL REFERENCES categories(slug),
      generated_at TEXT NOT NULL,
      content_date TEXT NOT NULL,
      received_at TEXT NOT NULL,
      published_at TEXT NOT NULL,
      language TEXT NOT NULL,
      source_url TEXT,
      tags_json TEXT NOT NULL,
      sanitized_html TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      raw_content_hash TEXT NOT NULL,
      sanitized_content_hash TEXT NOT NULL,
      sanitizer_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(article_id, version)
    );

    CREATE TABLE IF NOT EXISTS media_blobs (
      hash TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_version_media (
      article_version_id TEXT NOT NULL REFERENCES article_versions(id) ON DELETE CASCADE,
      media_hash TEXT NOT NULL REFERENCES media_blobs(hash),
      source_host TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY(article_version_id, media_hash, position)
    );

    CREATE TABLE IF NOT EXISTS idempotency_records (
      uploader_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(uploader_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS upload_audits (
      request_id TEXT PRIMARY KEY,
      uploader_id_claim TEXT,
      article_id TEXT,
      version INTEGER,
      result TEXT NOT NULL,
      error_code TEXT,
      content_length INTEGER NOT NULL DEFAULT 0,
      ip_digest TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_audits (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tts_provider_configs (
      id TEXT PRIMARY KEY,
      adapter_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      app_id_encrypted TEXT,
      api_key_encrypted TEXT,
      api_secret_encrypted TEXT,
      vcn TEXT NOT NULL DEFAULT 'x4_xiaoyan',
      speed INTEGER NOT NULL DEFAULT 50,
      volume INTEGER NOT NULL DEFAULT 50,
      pitch INTEGER NOT NULL DEFAULT 50,
      credential_revision INTEGER NOT NULL DEFAULT 0,
      profile_revision INTEGER NOT NULL DEFAULT 1,
      last_test_status TEXT,
      last_test_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tts_jobs (
      id TEXT PRIMARY KEY,
      article_version_id TEXT NOT NULL REFERENCES article_versions(id) ON DELETE CASCADE,
      provider_config_id TEXT REFERENCES tts_provider_configs(id),
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      safe_error_code TEXT,
      safe_error_message TEXT,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(article_version_id)
    );

    CREATE TABLE IF NOT EXISTS audio_assets (
      article_version_id TEXT PRIMARY KEY REFERENCES article_versions(id) ON DELETE CASCADE,
      tts_job_id TEXT NOT NULL REFERENCES tts_jobs(id),
      relative_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration_ms INTEGER,
      byte_size INTEGER NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_article_versions_timeline
      ON article_versions(content_date DESC, category_slug, generated_at DESC, article_id DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
    CREATE INDEX IF NOT EXISTS idx_upload_tokens_uploader
      ON upload_tokens(uploader_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_tts_jobs_status ON tts_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_upload_audits_created ON upload_audits(created_at DESC);
  `);

  // 老库迁移：确保 tts_jobs(article_version_id) 上有唯一约束。
  // 音频上传接口的 ON CONFLICT(article_version_id) 依赖它；而 CREATE TABLE IF NOT EXISTS
  // 不会给已存在的表补约束，缺约束的老库会在"同版本重复上传音频"时直接抛错 → 500 空 body。
  // 先按版本去重（保留 audio_assets 引用的一条，否则保留最新一条，避免外键失效），再建唯一索引。
  const hasVersionUnique = (
    database
      .prepare(`
        SELECT COUNT(*) AS n
        FROM pragma_index_list('tts_jobs') il
        JOIN pragma_index_info(il.name) ii
        WHERE il."unique" = 1 AND ii.name = 'article_version_id'
      `)
      .get() as { n: number }
  ).n > 0;
  if (!hasVersionUnique) {
    const duplicates = database
      .prepare(
        'SELECT article_version_id AS articleVersionId FROM tts_jobs GROUP BY article_version_id HAVING COUNT(*) > 1',
      )
      .all() as { articleVersionId: string }[];
    for (const { articleVersionId } of duplicates) {
      const keep = database
        .prepare(
          `SELECT COALESCE(
             (SELECT tts_job_id FROM audio_assets WHERE article_version_id = ?),
             (SELECT id FROM tts_jobs WHERE article_version_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1)
           ) AS id`,
        )
        .get(articleVersionId, articleVersionId) as { id: string };
      database
        .prepare('DELETE FROM tts_jobs WHERE article_version_id = ? AND id != ?')
        .run(articleVersionId, keep.id);
    }
    database.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_tts_jobs_article_version ON tts_jobs(article_version_id)',
    );
  }

  const now = new Date().toISOString();
  const seedCategory = database.prepare(`
    INSERT INTO categories(slug, name, color, sort_order, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(slug) DO NOTHING
  `);
  const categories = [
    ['technology', '科技新闻', '#73fbd3', 10],
    ['medical', '医疗', '#ff9db0', 20],
    ['cryptography', '密码学', '#a78bfa', 30],
  ] as const;
  for (const category of categories) {
    seedCategory.run(...category, now, now);
  }

  if (
    (
      database.prepare('SELECT COUNT(*) AS count FROM articles').get() as {
        count: number;
      }
    ).count === 0
  ) {
    database
      .prepare(`
        INSERT INTO uploaders(id, display_name, enabled, created_at, updated_at)
        VALUES ('demo-agent', 'Daily Agent', 1, ?, ?)
      `)
      .run(now, now);
    const demos = [
      {
        id: 'demo-tech',
        slug: '2026-09-07-technology-edge-agents',
        externalId: 'demo-edge-agents',
        title: '端侧智能体迎来新的协作范式',
        summary: '从任务编排到设备间上下文交接，今天值得关注的五项技术进展。',
        category: 'technology',
        generatedAt: '2026-09-07T09:10:00+08:00',
        tags: ['AI', '端侧计算'],
        html: '<h2>协作从云端走向设备</h2><p>端侧智能体正在从单点助手变成可交接任务、共享有限上下文的协作节点。</p><p>真正值得关注的不是更多动画，而是更清晰的权限边界、失败恢复与可审计的任务链路。</p>',
      },
      {
        id: 'demo-medical',
        slug: '2026-09-07-medical-screening-biomarkers',
        externalId: 'demo-screening-biomarkers',
        title: '早筛生物标志物研究进展速览',
        summary: '聚焦新发表队列研究的证据强度、适用人群与仍待验证的边界。',
        category: 'medical',
        generatedAt: '2026-09-07T08:42:00+08:00',
        tags: ['循证医学', '早筛'],
        html: '<h2>先看证据，再看结论</h2><p>新的生物标志物研究为早筛提供了更多候选路径，但队列来源、基线风险与外部验证仍决定其真实价值。</p><blockquote>一个漂亮的敏感度数字，并不自动等于可推广的人群筛查方案。</blockquote>',
      },
      {
        id: 'demo-crypto',
        slug: '2026-09-07-cryptography-post-quantum',
        externalId: 'demo-post-quantum',
        title: '后量子密码迁移：本周行动清单',
        summary: '梳理资产盘点、混合证书链与密钥生命周期中最容易被忽略的环节。',
        category: 'cryptography',
        generatedAt: '2026-09-07T07:55:00+08:00',
        tags: ['PQC', '工程实践'],
        html: '<h2>从资产清单开始</h2><p>迁移工作的第一步不是替换算法，而是找出所有长期保密数据、证书链和固件升级路径。</p><ul><li>记录密码资产与负责人</li><li>验证混合模式的互操作性</li><li>为回滚与密钥轮换保留窗口</li></ul>',
      },
    ];
    const insertArticle = database.prepare(`
      INSERT INTO articles(
        id, external_id, slug, uploader_id, current_version, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'demo-agent', 1, 'published', ?, ?)
    `);
    const insertVersion = database.prepare(`
      INSERT INTO article_versions(
        id, article_id, version, title, summary, category_slug, generated_at,
        content_date, received_at, published_at, language, tags_json,
        sanitized_html, extracted_text, raw_content_hash, sanitized_content_hash,
        sanitizer_version, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'zh-CN', ?, ?, ?, ?, ?, '1', ?)
    `);
    for (const demo of demos) {
      insertArticle.run(demo.id, demo.externalId, demo.slug, now, now);
      const extractedText = demo.html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const hash = createHash('sha256').update(demo.html).digest('hex');
      insertVersion.run(
        `${demo.id}-v1`,
        demo.id,
        demo.title,
        demo.summary,
        demo.category,
        demo.generatedAt,
        demo.generatedAt.slice(0, 10),
        now,
        now,
        JSON.stringify(demo.tags),
        demo.html,
        extractedText,
        hash,
        hash,
        now,
      );
    }
  }

  const upsertSetting = database.prepare(`
    INSERT INTO settings(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  if (process.env.ADMIN_PASSWORD) {
    upsertSetting.run(
      'admin_password_hash',
      hashPassword(process.env.ADMIN_PASSWORD),
      now,
    );
  }
  if (process.env.UPLOAD_PASSWORD) {
    upsertSetting.run(
      'upload_password_hash',
      hashPassword(process.env.UPLOAD_PASSWORD),
      now,
    );
  }

  database
    .prepare(`
      INSERT INTO tts_provider_configs(
        id, adapter_type, display_name, enabled, vcn, updated_at
      ) VALUES ('xfyun-default', 'xfyun-online-ws-v2', '科大讯飞在线语音合成', 0, 'x4_xiaoyan', ?)
      ON CONFLICT(id) DO NOTHING
    `)
    .run(now);

  database.pragma('optimize');
  return database;
}

export function getDb() {
  globalDatabase.dailyKnowledgeDb ??= createDatabase();
  return globalDatabase.dailyKnowledgeDb;
}

export function getDataRoot() {
  return dataRoot;
}
