import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { ArticleError, submitArticle } from '@/lib/articles';
import { ARTICLE_MAX_BYTES } from '@/lib/constants';
import { getDb } from '@/lib/db';
import { getRequestIp, verifyUploadRequest } from '@/lib/auth';
import { sha256 } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: { code, requestId } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const auth = verifyUploadRequest(request);
  if (!auth.ok) {
    const response = errorResponse(auth.code, auth.status, requestId);
    if ('retryAfterSeconds' in auth) {
      response.headers.set('Retry-After', String(auth.retryAfterSeconds));
    }
    return response;
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > ARTICLE_MAX_BYTES + 128 * 1024) {
    return errorResponse('ARTICLE_TOO_LARGE', 413, requestId);
  }

  try {
    const input = (await request.json()) as unknown;
    const result = await submitArticle(
      input,
      request.headers.get('idempotency-key') ?? '',
    );
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const articleError =
      error instanceof ArticleError
        ? error
        : new ArticleError('INTERNAL_ERROR', 500);
    getDb()
      .prepare(`
        INSERT INTO upload_audits(
          request_id, result, error_code, content_length, ip_digest, created_at
        ) VALUES (?, 'FAILED', ?, ?, ?, ?)
      `)
      .run(
        requestId,
        articleError.code,
        contentLength,
        sha256(getRequestIp(request)),
        new Date().toISOString(),
      );
    return errorResponse(articleError.code, articleError.status, requestId);
  }
}
