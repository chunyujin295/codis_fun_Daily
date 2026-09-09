import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

import { ADMIN_COOKIE_NAME, BASE_PATH } from '@/lib/constants';
import { hashPassword, sha256, verifyPassword } from '@/lib/crypto';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

export type AdminSession = {
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
};

export type UploadPrincipal = {
  tokenId: string;
  uploaderId: string;
  allowedCategories: string[];
};

export type GeneratedUploadToken = {
  id: string;
  token: string;
  tokenHash: string;
  tokenPrefix: string;
};

export type AdminUploadToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  enabled: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  categories: string[];
};

export type AdminUploader = {
  id: string;
  displayName: string;
  enabled: number;
  updatedAt: string;
  tokens: AdminUploadToken[];
};

type UploadTokenRow = {
  id: string;
  uploaderId: string;
  tokenHash: string;
  enabled: number;
  expiresAt: string | null;
  uploaderEnabled: number;
};

const UPLOAD_TOKEN_PATTERN =
  /^dk_live_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function generateUploadToken(): GeneratedUploadToken {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const token = `dk_live_${id}.${secret}`;
  return {
    id,
    token,
    tokenHash: sha256(token),
    tokenPrefix: `dk_live_${id.slice(0, 8)}`,
  };
}

export function parseUploadToken(token: string) {
  const match = UPLOAD_TOKEN_PATTERN.exec(token);
  return match ? { id: match[1] } : null;
}

export function issueUploadToken(input: {
  uploaderId: string;
  displayName: string;
  tokenName: string;
  categories: string[];
  expiresAt?: string;
}) {
  const categories = [...new Set(input.categories)];
  const db = getDb();
  const placeholders = categories.map(() => '?').join(', ');
  const enabledCategories = db
    .prepare(
      `SELECT slug FROM categories WHERE enabled = 1 AND slug IN (${placeholders})`,
    )
    .all(...categories) as { slug: string }[];
  if (enabledCategories.length !== categories.length) {
    throw new Error('UNKNOWN_OR_DISABLED_CATEGORY');
  }

  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new Error('TOKEN_EXPIRY_MUST_BE_FUTURE');
  }

  const generated = generateUploadToken();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO uploaders(id, display_name, enabled, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name,
        enabled = 1, updated_at = excluded.updated_at
    `).run(input.uploaderId, input.displayName, now, now);
    db.prepare(`
      INSERT INTO upload_tokens(
        id, uploader_id, name, token_hash, token_prefix, enabled,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      generated.id,
      input.uploaderId,
      input.tokenName,
      generated.tokenHash,
      generated.tokenPrefix,
      input.expiresAt ?? null,
      now,
      now,
    );
    const insertCategory = db.prepare(`
      INSERT INTO upload_token_categories(token_id, category_slug)
      VALUES (?, ?)
    `);
    for (const category of categories) {
      insertCategory.run(generated.id, category);
    }
  })();

  return {
    id: generated.id,
    token: generated.token,
    tokenPrefix: generated.tokenPrefix,
  };
}

export function getAdminUploaders(): AdminUploader[] {
  const db = getDb();
  const uploaders = db
    .prepare(`
      SELECT id, display_name AS displayName, enabled, updated_at AS updatedAt
      FROM uploaders ORDER BY updated_at DESC, id
    `)
    .all() as Omit<AdminUploader, 'tokens'>[];
  const tokens = db
    .prepare(`
      SELECT id, uploader_id AS uploaderId, name, token_prefix AS tokenPrefix,
        enabled, expires_at AS expiresAt, last_used_at AS lastUsedAt,
        created_at AS createdAt
      FROM upload_tokens ORDER BY created_at DESC
    `)
    .all() as (Omit<AdminUploadToken, 'categories'> & {
    uploaderId: string;
  })[];
  const categoryRows = db
    .prepare(`
      SELECT token_id AS tokenId, category_slug AS category
      FROM upload_token_categories ORDER BY category_slug
    `)
    .all() as { tokenId: string; category: string }[];
  const categoriesByToken = new Map<string, string[]>();
  for (const row of categoryRows) {
    const values = categoriesByToken.get(row.tokenId) ?? [];
    values.push(row.category);
    categoriesByToken.set(row.tokenId, values);
  }
  const tokensByUploader = new Map<string, AdminUploadToken[]>();
  for (const token of tokens) {
    const values = tokensByUploader.get(token.uploaderId) ?? [];
    const { uploaderId: _uploaderId, ...tokenFields } = token;
    values.push({
      ...tokenFields,
      categories: categoriesByToken.get(token.id) ?? [],
    });
    tokensByUploader.set(token.uploaderId, values);
  }
  return uploaders.map((uploader) => ({
    ...uploader,
    tokens: tokensByUploader.get(uploader.id) ?? [],
  }));
}

export function setUploadTokenEnabled(tokenId: string, enabled: boolean) {
  const result = getDb()
    .prepare(`
      UPDATE upload_tokens SET enabled = ?, updated_at = ? WHERE id = ?
    `)
    .run(enabled ? 1 : 0, new Date().toISOString(), tokenId);
  return result.changes > 0;
}

export function revokeUploadToken(tokenId: string) {
  const result = getDb()
    .prepare('DELETE FROM upload_tokens WHERE id = ?')
    .run(tokenId);
  return result.changes > 0;
}

function equalHash(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function verifyIndependentUploadToken(token: string): UploadPrincipal | null {
  const parsed = parseUploadToken(token);
  if (!parsed) return null;

  const db = getDb();
  const row = db
    .prepare(`
      SELECT t.id, t.uploader_id AS uploaderId, t.token_hash AS tokenHash,
        t.enabled, t.expires_at AS expiresAt, u.enabled AS uploaderEnabled
      FROM upload_tokens t
      JOIN uploaders u ON u.id = t.uploader_id
      WHERE t.id = ?
    `)
    .get(parsed.id) as UploadTokenRow | undefined;

  if (
    !row ||
    row.enabled !== 1 ||
    row.uploaderEnabled !== 1 ||
    (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) ||
    !equalHash(sha256(token), row.tokenHash)
  ) {
    return null;
  }

  const allowedCategories = db
    .prepare(`
      SELECT category_slug AS category
      FROM upload_token_categories
      WHERE token_id = ?
      ORDER BY category_slug
    `)
    .all(row.id) as { category: string }[];

  db.prepare('UPDATE upload_tokens SET last_used_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.id,
  );

  return {
    tokenId: row.id,
    uploaderId: row.uploaderId,
    allowedCategories: allowedCategories.map((item) => item.category),
  };
}

export function getRequestIp(request: Request) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function getSetting(key: string) {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .run(key, value, new Date().toISOString());
}

export function isAdminPasswordConfigured() {
  return Boolean(getSetting('admin_password_hash'));
}

export function verifyAdminPassword(password: string) {
  return verifyPassword(password, getSetting('admin_password_hash'));
}

export function updateAdminPassword(password: string) {
  setSetting('admin_password_hash', hashPassword(password));
  getDb().prepare('DELETE FROM admin_sessions').run();
}

export function updateUploadPassword(password: string) {
  setSetting('upload_password_hash', hashPassword(password));
}

export function verifyUploadRequest(request: Request) {
  const ip = getRequestIp(request);
  const limit = checkRateLimit(`upload:${ip}`, 30, 60_000);
  if (!limit.allowed) {
    return {
      ok: false as const,
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  const credential = match?.[1] ?? '';
  if (!credential || credential.length > 512) {
    return { ok: false as const, status: 401, code: 'INVALID_CREDENTIALS' };
  }

  const principal = verifyIndependentUploadToken(credential);
  if (principal) {
    const tokenLimit = checkRateLimit(
      `upload-token:${principal.tokenId}`,
      20,
      60_000,
    );
    if (!tokenLimit.allowed) {
      return {
        ok: false as const,
        status: 429,
        code: 'RATE_LIMITED',
        retryAfterSeconds: tokenLimit.retryAfterSeconds,
      };
    }
    return { ok: true as const, mode: 'token' as const, principal };
  }

  const legacyAllowed =
    process.env.ALLOW_LEGACY_UPLOAD_PASSWORD?.toLowerCase() !== 'false';
  if (
    legacyAllowed &&
    verifyPassword(credential, getSetting('upload_password_hash'))
  ) {
    return { ok: true as const, mode: 'legacy' as const, principal: null };
  }

  return { ok: false as const, status: 401, code: 'INVALID_CREDENTIALS' };
}

export function createAdminSession() {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const csrfToken = randomBytes(24).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  getDb()
    .prepare(`
      INSERT INTO admin_sessions(token_hash, csrf_token, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      tokenHash,
      csrfToken,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
  return { token, csrfToken, expiresAt };
}

function getSessionByToken(token: string | undefined): AdminSession | null {
  if (!token || token.length > 512) return null;
  const tokenHash = sha256(token);
  const row = getDb()
    .prepare(`
      SELECT token_hash AS tokenHash, csrf_token AS csrfToken, expires_at AS expiresAt
      FROM admin_sessions WHERE token_hash = ?
    `)
    .get(tokenHash) as AdminSession | undefined;

  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    if (row) {
      getDb()
        .prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
        .run(tokenHash);
    }
    return null;
  }

  getDb()
    .prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .run(new Date().toISOString(), tokenHash);
  return row;
}

export async function getCurrentAdminSession() {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  return getSessionByToken(token);
}

export async function requireAdminPage() {
  const session = await getCurrentAdminSession();
  if (!session) redirect(`${BASE_PATH}/admin/login`);
  return session;
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const configured = process.env.PUBLIC_BASE_URL ?? 'https://codis.fun/Daily';
  const allowed = new Set([
    new URL(configured).origin,
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ]);
  return allowed.has(origin);
}

export function requireAdminRequest(request: NextRequest, mutation = false) {
  const session = getSessionByToken(
    request.cookies.get(ADMIN_COOKIE_NAME)?.value,
  );
  if (!session)
    return { ok: false as const, status: 401, code: 'UNAUTHORIZED' };
  if (
    mutation &&
    (!isAllowedOrigin(request) ||
      request.headers.get('x-csrf-token') !== session.csrfToken)
  ) {
    return { ok: false as const, status: 403, code: 'INVALID_CSRF' };
  }
  return { ok: true as const, session };
}

export function deleteAdminSession(token: string | undefined) {
  if (!token) return;
  getDb()
    .prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
    .run(sha256(token));
}

export function auditAdmin(
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown> = {},
) {
  getDb()
    .prepare(`
      INSERT INTO admin_audits(id, action, target_type, target_id, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      action,
      targetType,
      targetId,
      JSON.stringify(detail),
      new Date().toISOString(),
    );
}
