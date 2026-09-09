import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { ArticleError, submitArticle } from '@/lib/articles';
import { verifyUploadRequest } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ externalId: string }> },
) {
  const requestId = randomUUID();
  const auth = verifyUploadRequest(request);
  if (!auth.ok) {
    const response = NextResponse.json(
      { error: { code: auth.code, requestId } },
      { status: auth.status, headers: { 'Cache-Control': 'no-store' } },
    );
    if ('retryAfterSeconds' in auth) {
      response.headers.set('Retry-After', String(auth.retryAfterSeconds));
    }
    return response;
  }

  try {
    const { externalId } = await context.params;
    const input = (await request.json()) as unknown;
    const result = await submitArticle(
      input,
      request.headers.get('idempotency-key') ?? '',
      {
        expectedExternalId: externalId,
        principal: auth.principal ?? undefined,
      },
    );
    return NextResponse.json(result, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const articleError =
      error instanceof ArticleError
        ? error
        : new ArticleError('INTERNAL_ERROR', 500);
    return NextResponse.json(
      { error: { code: articleError.code, requestId } },
      {
        status: articleError.status,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
