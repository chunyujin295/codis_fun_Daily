import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  createAdminSession,
  getRequestIp,
  isAdminPasswordConfigured,
  verifyAdminPassword,
} from '@/lib/auth';
import { ADMIN_COOKIE_NAME, BASE_PATH } from '@/lib/constants';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(
    `admin-login:${getRequestIp(request)}`,
    8,
    5 * 60_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '尝试次数过多，请稍后再试。' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      },
    );
  }
  if (!isAdminPasswordConfigured()) {
    return NextResponse.json(
      { error: '管理员密码尚未初始化。' },
      { status: 503 },
    );
  }
  const parsed = z
    .object({ password: z.string().min(1).max(512) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyAdminPassword(parsed.data.password)) {
    return NextResponse.json({ error: '密码不正确。' }, { status: 401 });
  }

  const session = createAdminSession();
  const response = NextResponse.json({
    ok: true,
    redirect: `${BASE_PATH}/admin`,
  });
  response.cookies.set(ADMIN_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `${BASE_PATH}/admin`,
    expires: session.expiresAt,
    priority: 'high',
  });
  return response;
}
