import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createXfyunSignedUrl, segmentText } from '@/lib/tts';

describe('Xfyun adapter protocol', () => {
  it('creates the documented HMAC websocket query without exposing the secret', () => {
    const now = new Date('2026-09-07T06:00:00.000Z');
    const url = new URL(createXfyunSignedUrl('fake-key', 'fake-secret', now));
    expect(url.origin).toBe('wss://tts-api.xfyun.cn');
    expect(url.pathname).toBe('/v2/tts');
    expect(url.searchParams.get('date')).toBe(now.toUTCString());
    expect(url.toString()).not.toContain('fake-secret');

    const expectedSignature = createHmac('sha256', 'fake-secret')
      .update(
        `host: tts-api.xfyun.cn\ndate: ${now.toUTCString()}\nGET /v2/tts HTTP/1.1`,
      )
      .digest('base64');
    const authorization = Buffer.from(
      url.searchParams.get('authorization') ?? '',
      'base64',
    ).toString('utf8');
    expect(authorization).toContain(`signature="${expectedSignature}"`);
  });

  it('segments Chinese text below the conservative UTF-8 byte limit', () => {
    const input = `${'这是一个用于测试自然分段的句子。'.repeat(900)}结束。`;
    const chunks = segmentText(input);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') < 7600),
    ).toBe(true);
    expect(chunks.join('')).toBe(input);
  });
});
