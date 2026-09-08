import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
process.env.HOSTNAME ??= '127.0.0.1';
process.env.PORT ??= '3000';
process.env.DATA_DIR ??= path.join(projectRoot, 'data');
process.env.DATABASE_PATH ??= path.join(
  process.env.DATA_DIR,
  'daily-knowledge.db',
);

await import('../.next/standalone/server.js');
