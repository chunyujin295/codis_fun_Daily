import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { getDataRoot, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ externalId: string }> },
) {
  const { externalId: articleId } = await context.params;
  const row = getDb()
    .prepare(`
      SELECT aa.relative_path AS relativePath, aa.hash
      FROM articles a
      JOIN article_versions v
        ON v.article_id = a.id AND v.version = a.current_version
      JOIN tts_jobs j ON j.article_version_id = v.id AND j.status = 'READY'
      JOIN audio_assets aa ON aa.article_version_id = v.id
      WHERE a.id = ? AND a.status = 'published'
    `)
    .get(articleId) as { relativePath: string; hash: string } | undefined;
  if (!row) return new NextResponse(null, { status: 404 });

  const filePath = path.resolve(getDataRoot(), row.relativePath);
  const audioRoot = path.resolve(getDataRoot(), 'audio');
  if (!filePath.startsWith(`${audioRoot}${path.sep}`)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const details = await stat(filePath);
    const range = request.headers.get('range');
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'audio/mpeg',
      ETag: `"${row.hash}"`,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    };

    if (!range) {
      const handle = await open(filePath, 'r');
      const buffer = Buffer.alloc(details.size);
      await handle.read(buffer, 0, details.size, 0);
      await handle.close();
      return new NextResponse(buffer, {
        headers: { ...baseHeaders, 'Content-Length': String(details.size) },
      });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${details.size}` },
      });
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : details.size - 1;
    if (start < 0 || end < start || end >= details.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${details.size}` },
      });
    }
    const length = end - start + 1;
    const handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    await handle.close();
    return new NextResponse(buffer, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${details.size}`,
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
