import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  auditAdmin,
  requireAdminRequest,
  revokeUploadToken,
  setUploadTokenEnabled,
} from '@/lib/auth';

export const runtime = 'nodejs';

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_TOKEN_STATUS' },
      { status: 422 },
    );
  }
  const { id } = await context.params;
  if (!setUploadTokenEnabled(id, parsed.data.enabled)) {
    return NextResponse.json({ error: 'TOKEN_NOT_FOUND' }, { status: 404 });
  }
  auditAdmin(
    parsed.data.enabled ? 'UPLOAD_TOKEN_ENABLE' : 'UPLOAD_TOKEN_DISABLE',
    'upload-token',
    id,
  );
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!revokeUploadToken(id)) {
    return NextResponse.json({ error: 'TOKEN_NOT_FOUND' }, { status: 404 });
  }
  auditAdmin('UPLOAD_TOKEN_REVOKE', 'upload-token', id);
  return NextResponse.json({ ok: true });
}
