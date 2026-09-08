import { randomBytes, randomUUID } from 'node:crypto';
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
  const [scheme, password] = authorization.split(' ', 2);
  const valid =
    scheme?.toLowerCase() === 'bearer' &&
    Boolean(password) &&
    password.length <= 512 &&
    verifyPassword(password, getSetting('upload_password_hash'));

  if (!valid) {
    return { ok: false as const, status: 401, code: 'INVALID_CREDENTIALS' };
  }
  return { ok: true as const };
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
