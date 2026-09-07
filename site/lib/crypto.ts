import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, saltValue, digestValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !digestValue) return false;

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(digestValue, 'base64url');
    const actual = scryptSync(password, salt, expected.length);
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

function getMasterKey() {
  const configured = process.env.TTS_MASTER_KEY;
  if (!configured) {
    throw new Error('TTS_MASTER_KEY_NOT_CONFIGURED');
  }

  const key = Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('TTS_MASTER_KEY_MUST_BE_32_BYTES_BASE64');
  }
  return key;
}

export function encryptSecret(value: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv);
  cipher.setAAD(Buffer.from(`daily-knowledge:${purpose}`, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, encrypted]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join('.');
}

export function decryptSecret(value: string, purpose: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('INVALID_ENCRYPTED_SECRET');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getMasterKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAAD(Buffer.from(`daily-knowledge:${purpose}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
