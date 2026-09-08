import { beforeAll, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  verifyPassword,
} from '@/lib/crypto';

describe('credential protection', () => {
  beforeAll(() => {
    process.env.TTS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('hashes and verifies passwords without storing plaintext', () => {
    const encoded = hashPassword('a-long-test-password');
    expect(encoded).not.toContain('a-long-test-password');
    expect(verifyPassword('a-long-test-password', encoded)).toBe(true);
    expect(verifyPassword('wrong-password', encoded)).toBe(false);
  });

  it('binds encrypted values to their purpose', () => {
    const encrypted = encryptSecret('fake-secret', 'provider:apiKey');
    expect(encrypted).not.toContain('fake-secret');
    expect(decryptSecret(encrypted, 'provider:apiKey')).toBe('fake-secret');
    expect(() => decryptSecret(encrypted, 'provider:apiSecret')).toThrow();
  });
});
