import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

function showHelp() {
  console.log(`Usage:
  npm run publish -- <article.html> [metadata.json] [--update]

Quick setup:
  Copy .env.agent.example to .env.agent once, then fill in the site URL
  and independently issued upload token. If metadata.json is omitted, the script reads
  <article-name>.metadata.json next to the HTML file.

Environment:
  DAILY_BASE_URL         Default: http://127.0.0.1:3000/Daily
  DAILY_UPLOAD_TOKEN     Required independently issued upload token
  DAILY_UPLOAD_PASSWORD  Backward-compatible alias for DAILY_UPLOAD_TOKEN
  DAILY_IDEMPOTENCY_KEY  Optional; defaults to a hash of metadata + HTML

This file has no package dependencies. On a machine without this repository:
  node --env-file=.env.agent push-article.mjs <article.html> [metadata.json]
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

const update = args.includes('--update');
const positional = args.filter((value) => !value.startsWith('--'));
if (positional.length < 1 || positional.length > 2) {
  showHelp();
  process.exit(2);
}

const htmlPath = positional[0];
const metadataPath =
  positional[1] ??
  (htmlPath.toLowerCase().endsWith('.html')
    ? `${htmlPath.slice(0, -5)}.metadata.json`
    : `${htmlPath}.metadata.json`);
const password =
  process.env.DAILY_UPLOAD_TOKEN ?? process.env.DAILY_UPLOAD_PASSWORD;
if (!password) {
  throw new Error(
    'DAILY_UPLOAD_TOKEN is required; copy .env.agent.example to .env.agent and configure it once',
  );
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

const summaryLength =
  typeof metadata.summary === 'string' ? metadata.summary.trim().length : 0;
if (summaryLength > 100) {
  throw new Error(
    `metadata.summary is ${summaryLength} characters; the hard limit is 100`,
  );
}

// base64 内嵌图片会让 HTML 体积涨约 1.33 倍，而服务端只接受 2 MB 以内的 HTML。
const htmlBytes = Buffer.byteLength(html, 'utf8');
if (htmlBytes > 2 * 1024 * 1024) {
  throw new Error(
    `article HTML is ${(htmlBytes / 1024 / 1024).toFixed(2)} MB (${htmlBytes} bytes); the hard limit is 2 MB (2097152 bytes) - compress the base64 images`,
  );
}

const body = JSON.stringify({ ...metadata, html });
const idempotencyKey =
  process.env.DAILY_IDEMPOTENCY_KEY ??
  `agent-${createHash('sha256').update(body).digest('hex').slice(0, 48)}`;
const normalizedBase = baseUrl.toString().replace(/\/$/, '');
const endpoint = update
  ? `${normalizedBase}/api/v1/articles/${encodeURIComponent(metadata.externalId)}`
  : `${normalizedBase}/api/v1/articles`;

const retryScheduleMs = [0, 2_000, 10_000, 30_000];
let response;
let result;
for (let attempt = 0; attempt < retryScheduleMs.length; attempt += 1) {
  if (retryScheduleMs[attempt] > 0) {
    await sleep(retryScheduleMs[attempt]);
  }
  try {
    response = await fetch(endpoint, {
      method: update ? 'PUT' : 'POST',
      headers: {
        Authorization: `Bearer ${password}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotency-Key': idempotencyKey,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (attempt === retryScheduleMs.length - 1) throw error;
    continue;
  }

  result = await response.json().catch(() => ({
    error: { code: 'INVALID_SERVER_RESPONSE' },
  }));
  const retryable = response.status === 429 || response.status >= 500;
  if (!retryable || attempt === retryScheduleMs.length - 1) break;

  const retryAfterSeconds = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    retryScheduleMs[attempt + 1] = Math.min(retryAfterSeconds * 1_000, 60_000);
  }
}

if (!response || !result) {
  throw new Error('UPLOAD_FAILED_WITHOUT_RESPONSE');
}
const publicUrl = result.article?.url
  ? new URL(result.article.url, baseUrl.origin).toString()
  : undefined;

if (!response.ok) {
  console.error(
    JSON.stringify({ status: response.status, response: result }, null, 2),
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
