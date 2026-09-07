import { access, constants } from 'node:fs/promises';
import { NextResponse } from 'next/server';

import { getDataRoot, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    getDb().prepare('SELECT 1').get();
    await access(getDataRoot(), constants.R_OK | constants.W_OK);
    return NextResponse.json(
      { status: 'ready' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
