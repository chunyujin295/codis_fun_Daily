import { describe, expect, it } from 'vitest';

import { articleInputSchema } from '@/lib/articles';

describe('article upload schema', () => {
  const valid = {
    schemaVersion: '1',
    uploaderId: 'tech-agent',
    externalId: 'daily-2026-09-07',
    title: '今日科技简报',
    summary: '摘要',
    category: 'technology',
    generatedAt: '2026-09-07T08:00:00+08:00',
    tags: ['AI'],
    language: 'zh-CN',
    html: '<article><p>正文</p></article>',
  };

  it('accepts the versioned upload contract', () => {
    expect(articleInputSchema.safeParse(valid).success).toBe(true);
  });

  it('requires an explicit timezone and safe uploader id', () => {
    expect(
      articleInputSchema.safeParse({
        ...valid,
        generatedAt: '2026-09-07T08:00:00',
      }).success,
    ).toBe(false);
    expect(
      articleInputSchema.safeParse({ ...valid, uploaderId: '../other-agent' })
        .success,
    ).toBe(false);
  });
});
