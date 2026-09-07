import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { getDataRoot } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: RouteContext<'/media/images/[filename]'>,
) {
  const { filename } = await context.params;
  const match = /^([a-f0-9]{64})\.webp$/.exec(filename);
  if (!match) return new NextResponse(null, { status: 404 });
  const hash = match[1];
  const filePath = path.join(
    getDataRoot(),
    'images',
    'sha256',
    hash.slice(0, 2),
    `${hash}.webp`,
  );
  try {
    const body = await readFile(filePath);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(body.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
