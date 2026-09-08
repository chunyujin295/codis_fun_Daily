import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function showHelp() {
  console.log(`Usage:
  npm run push:article -- <article.html> <metadata.json> [--update]

Environment:
  DAILY_BASE_URL         Default: http://127.0.0.1:3000/Daily
  DAILY_UPLOAD_PASSWORD  Required shared upload password
  DAILY_IDEMPOTENCY_KEY  Optional; defaults to a hash of metadata + HTML
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

const update = args.includes('--update');
const positional = args.filter((value) => !value.startsWith('--'));
if (positional.length !== 2) {
  showHelp();
  process.exit(2);
}

const [htmlPath, metadataPath] = positional;
const password = process.env.DAILY_UPLOAD_PASSWORD;
if (!password) {
  throw new Error('DAILY_UPLOAD_PASSWORD is required');
}

const baseUrl = new URL(
  process.env.DAILY_BASE_URL ?? 'http://127.0.0.1:3000/Daily',
);
const isLocalHttp =
  baseUrl.protocol === 'http:' &&
  ['127.0.0.1', 'localhost'].includes(baseUrl.hostname);
if (baseUrl.protocol !== 'https:' && !isLocalHttp) {
  throw new Error('DAILY_BASE_URL must use HTTPS except for localhost');
}
if (baseUrl.username || baseUrl.password) {
  throw new Error('Do not put credentials in DAILY_BASE_URL');
}

const html = await readFile(htmlPath, 'utf8');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
for (const field of [
  'schemaVersion',
  'uploaderId',
  'externalId',
  'title',
  'category',
  'generatedAt',
]) {
  if (typeof metadata[field] !== 'string' || !metadata[field]) {
    throw new Error(`metadata.${field} is required`);
  }
}

const body = JSON.stringify({ ...metadata, html });
const idempotencyKey =
  process.env.DAILY_IDEMPOTENCY_KEY ??
  `agent-${createHash('sha256').update(body).digest('hex').slice(0, 48)}`;
const normalizedBase = baseUrl.toString().replace(/\/$/, '');
const endpoint = update
  ? `${normalizedBase}/api/v1/articles/${encodeURIComponent(metadata.externalId)}`
  : `${normalizedBase}/api/v1/articles`;

const response = await fetch(endpoint, {
  method: update ? 'PUT' : 'POST',
  headers: {
    Authorization: `Bearer ${password}`,
    'Content-Type': 'application/json; charset=utf-8',
    'Idempotency-Key': idempotencyKey,
  },
  body,
});
const result = await response.json().catch(() => ({
  error: { code: 'INVALID_SERVER_RESPONSE' },
}));
const publicUrl = result.article?.url
  ? new URL(result.article.url, baseUrl.origin).toString()
  : undefined;

if (!response.ok) {
  console.error(
    JSON.stringify(
      { status: response.status, response: result },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: response.status,
        url: publicUrl,
        version: result.article?.version,
        articleStatus: result.article?.status,
        audioStatus: result.article?.audioStatus,
        replayed: result.replayed ?? false,
      },
      null,
      2,
    ),
  );
}
