import { NextResponse, type NextRequest } from 'next/server';

import { deleteAdminSession, requireAdminRequest } from '@/lib/auth';
import { ADMIN_COOKIE_NAME, BASE_PATH } from '@/lib/constants';

export const runtime = 'nodejs';

export function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  deleteAdminSession(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `${BASE_PATH}/admin`,
    maxAge: 0,
  });
  return response;
}
