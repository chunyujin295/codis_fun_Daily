import { describe, expect, it } from 'vitest';

import { generateUploadToken, parseUploadToken } from '@/lib/auth';
import {
  ArticleError,
  assertUploadPrincipal,
  type ArticleInput,
} from '@/lib/articles';

const article: ArticleInput = {
  schemaVersion: '1',
  uploaderId: 'tech-agent',
  externalId: 'technology-2026-09-09',
  title: '今日科技简报',
  summary: '摘要',
  category: 'technology',
  generatedAt: '2026-09-09T08:00:00+08:00',
  tags: ['AI'],
  language: 'zh-CN',
  html: '<article><p>正文</p></article>',
};

describe('independent upload tokens', () => {
  it('generates a parseable token without storing plaintext as its hash', () => {
    const generated = generateUploadToken();

    expect(parseUploadToken(generated.token)).toEqual({ id: generated.id });
    expect(generated.token).toMatch(/^dk_live_/);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).not.toContain(generated.token);
  });

  it('rejects malformed tokens', () => {
    expect(parseUploadToken('shared-password')).toBeNull();
    expect(parseUploadToken('dk_live_bad.token')).toBeNull();
  });
});

describe('upload principal authorization', () => {
  const principal = {
    tokenId: 'token-id',
    uploaderId: 'tech-agent',
    allowedCategories: ['technology'],
  };

  it('accepts the bound uploader and category', () => {
    expect(() => assertUploadPrincipal(article, principal)).not.toThrow();
  });

  it('rejects uploader impersonation', () => {
    expect(() =>
      assertUploadPrincipal(
        { ...article, uploaderId: 'other-agent' },
        principal,
      ),
    ).toThrow(new ArticleError('UPLOADER_MISMATCH', 403));
  });

  // 2026-09-11 起取消"令牌按栏目授权"：只要栏目在站点已启用即可发布，
  // 不再受 principal.allowedCategories 限制（栏目是否启用由 submitArticle 校验）。
  it('accepts any category regardless of the token scope', () => {
    expect(() =>
      assertUploadPrincipal({ ...article, category: 'medical' }, principal),
    ).not.toThrow();
    expect(() =>
      assertUploadPrincipal({ ...article, category: 'cryptography' }, principal),
    ).not.toThrow();
  });

  it('keeps legacy and administrator submissions compatible', () => {
    expect(() => assertUploadPrincipal(article, undefined)).not.toThrow();
  });
});
