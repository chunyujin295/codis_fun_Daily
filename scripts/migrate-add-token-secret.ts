import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH ?? './data/daily-knowledge.db';
const db = new Database(dbPath);

// 检查 token_secret 列是否存在
const columns = db.prepare("PRAGMA table_info(upload_tokens)").all() as { name: string }[];
const hasTokenSecret = columns.some(col => col.name === 'token_secret');

if (!hasTokenSecret) {
  console.log('Adding token_secret column to upload_tokens table...');
  db.prepare('ALTER TABLE upload_tokens ADD COLUMN token_secret TEXT').run();
  
  // 为现有令牌生成 secret
  const tokens = db.prepare('SELECT id FROM upload_tokens WHERE token_secret IS NULL').all() as { id: string }[];
  console.log(`Generating secrets for ${tokens.length} existing tokens...`);
  
  const update = db.prepare('UPDATE upload_tokens SET token_secret = ? WHERE id = ?');
  for (const token of tokens) {
    const secret = randomBytes(32).toString('base64url');
    update.run(secret, token.id);
  }
  
  console.log('Migration completed.');
} else {
  console.log('token_secret column already exists.');
}

db.close();
