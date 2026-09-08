import { NextResponse, type NextRequest } from 'next/server';

import { setArticleArchived } from '@/lib/articles';
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
  if (!setArticleArchived(id, true)) {
    return NextResponse.json({ error: 'ARTICLE_NOT_FOUND' }, { status: 404 });
  }
  auditAdmin('ARTICLE_ARCHIVE', 'article', id);
  return NextResponse.json({ ok: true });
}
