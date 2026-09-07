import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  auditAdmin,
  requireAdminRequest,
  updateUploadPassword,
} from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const parsed = z
    .object({ password: z.string().min(16).max(512) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '密码至少需要 16 个字符。' },
      { status: 422 },
    );
  }
  updateUploadPassword(parsed.data.password);
  auditAdmin('UPLOAD_PASSWORD_ROTATE', 'setting', 'upload-password');
  return NextResponse.json({ ok: true });
}
