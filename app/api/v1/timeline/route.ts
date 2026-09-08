import { NextResponse } from 'next/server';

import { getTimelineRows } from '@/lib/articles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const items = getTimelineRows().map((row) => ({
    ...row,
    tags: JSON.parse(row.tagsJson) as string[],
    tagsJson: undefined,
  }));
  return NextResponse.json(
    { items },
    {
      headers: {
        'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
      },
    },
  );
}
