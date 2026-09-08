import { NextResponse } from 'next/server';

import { BASE_PATH } from '@/lib/constants';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ externalId: string }> },
) {
  const { externalId: articleId } = await context.params;
  const row = getDb()
    .prepare(`
      SELECT COALESCE(j.status, 'UNAVAILABLE') AS status,
        aa.duration_ms AS durationMs
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      LEFT JOIN tts_jobs j ON j.article_version_id = v.id
      LEFT JOIN audio_assets aa ON aa.article_version_id = v.id
      WHERE a.id = ? AND a.status = 'published'
    `)
    .get(articleId) as
    | { status: string; durationMs: number | null }
    | undefined;
  if (!row) return new NextResponse(null, { status: 404 });
  return NextResponse.json(
    {
      status: row.status,
      durationMs: row.durationMs,
      streamUrl:
        row.status === 'READY'
          ? `${BASE_PATH}/api/v1/articles/${articleId}/audio/stream`
          : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
