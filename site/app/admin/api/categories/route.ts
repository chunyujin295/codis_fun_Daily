import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auditAdmin, requireAdminRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

const schema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const auth = requireAdminRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.code }, { status: auth.status });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_CATEGORY' }, { status: 422 });
  }
  const value = parsed.data;
  const now = new Date().toISOString();
  getDb()
    .prepare(`
      INSERT INTO categories(slug, name, color, sort_order, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET name = excluded.name, color = excluded.color,
        sort_order = excluded.sort_order, enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `)
    .run(
      value.slug,
      value.name,
      value.color,
      value.sortOrder,
      value.enabled ? 1 : 0,
      now,
      now,
    );
  auditAdmin('CATEGORY_UPSERT', 'category', value.slug, {
    enabled: value.enabled,
  });
  return NextResponse.json({ ok: true });
}
