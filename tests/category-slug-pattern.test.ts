import { describe, expect, it } from 'vitest';

import { CATEGORY_SLUG_PATTERN } from '@/lib/constants';

// 背景（回归来源）：HTML 的 pattern 属性现在按 RegExp 的 'v' 标志编译。
// v 模式下字符类里未转义的尾部 "-" 会让整个 pattern 编译失败，而按规范
// **编译失败的 pattern 会被浏览器静默忽略** —— 客户端校验完全失效，非法 slug
// 会直接打到服务端，只返回一个不带字段名的 INVALID_CATEGORY。
// 所以这里用 'v' 标志断言它能编译，并校验语义与服务端一致。
const browserPattern = () => new RegExp(`^(?:${CATEGORY_SLUG_PATTERN})$`, 'v');
const serverPattern = () => new RegExp(`^${CATEGORY_SLUG_PATTERN}$`);

const accepted: [string, string][] = [
  ['单个字母', 'a'],
  ['单个数字', '1'],
  ['纯字母', 'ai'],
  ['字母加数字', 'a1'],
  ['含连字符', 'ai-news'],
  ['多段连字符', 'ai-news-2026'],
];

const rejected: [string, string][] = [
  ['大写字母', 'AI'],
  ['混合大小写', 'Ai-News'],
  ['下划线', 'ai_news'],
  ['中文', '人工智能'],
  ['以连字符开头', '-ai'],
  ['含空格', 'ai news'],
  ['含点号', 'ai.news'],
  ['空字符串', ''],
];

describe('category slug pattern', () => {
  it('能在 pattern 属性所用的 v 标志下编译成功', () => {
    expect(() => browserPattern()).not.toThrow();
  });

  it.each(accepted)('接受 %s', (_label, value) => {
    expect(browserPattern().test(value)).toBe(true);
    expect(serverPattern().test(value)).toBe(true);
  });

  it.each(rejected)('拒绝 %s', (_label, value) => {
    expect(browserPattern().test(value)).toBe(false);
    expect(serverPattern().test(value)).toBe(false);
  });

  it('前端 pattern 与服务端正则语义一致', () => {
    for (const [, value] of [...accepted, ...rejected]) {
      expect(browserPattern().test(value)).toBe(serverPattern().test(value));
    }
  });
});
