import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auditAdmin, issueUploadToken, requireAdminRequest } from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({
  uploaderId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  displayName: z.string().trim().min(1).max(80),
  tokenName: z.string().trim().min(1).max(80),
  // 栏目不再按令牌授权（2026-09-11 起）：允许为空，表示"所有已启用栏目"。
  categories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_UPLOAD_TOKEN' },
      { status: 422 },
    );
  }
  try {
    const token = issueUploadToken(parsed.data);
    auditAdmin('UPLOAD_TOKEN_ISSUE', 'upload-token', token.id, {
      uploaderId: parsed.data.uploaderId,
      categories: parsed.data.categories,
      expiresAt: parsed.data.expiresAt ?? null,
    });
    return NextResponse.json({ token }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TOKEN_ISSUE_FAILED';
    if (
      code === 'UNKNOWN_OR_DISABLED_CATEGORY' ||
      code === 'TOKEN_EXPIRY_MUST_BE_FUTURE'
    ) {
      return NextResponse.json({ error: code }, { status: 422 });
    }
    return NextResponse.json({ error: 'TOKEN_ISSUE_FAILED' }, { status: 500 });
  }
}
