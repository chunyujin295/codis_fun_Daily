import { NextResponse, type NextRequest } from 'next/server';

import { deleteArticle } from '@/lib/articles';
import { auditAdmin, requireAdminRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await deleteArticle(id))) {
    return NextResponse.json({ error: 'ARTICLE_NOT_FOUND' }, { status: 404 });
  }
  auditAdmin('ARTICLE_DELETE', 'article', id);
  return NextResponse.json({ ok: true, deleted: true });
}
