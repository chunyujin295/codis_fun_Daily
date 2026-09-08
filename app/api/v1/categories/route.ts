import { NextResponse } from 'next/server';

import { getCategories } from '@/lib/articles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { categories: getCategories().filter((category) => category.enabled) },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
