import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { auditAdmin, requireAdminRequest } from '@/lib/auth';
import { CATEGORY_SLUG_PATTERN } from '@/lib/constants';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

const schema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    // 与前端 <Input pattern> 共用同一份来源，避免两边规则漂移。
    .regex(new RegExp(`^${CATEGORY_SLUG_PATTERN}$`)),
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
    // 带上出错字段名，否则前端只能显示一个 INVALID_CATEGORY，无法定位是哪个字段不合法。
    const fields = [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path.join('.'))
          .filter((path) => path.length > 0),
      ),
    ];
    return NextResponse.json(
      { error: 'INVALID_CATEGORY', fields },
      { status: 422 },
    );
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
