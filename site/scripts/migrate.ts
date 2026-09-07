import { getDb } from '../lib/db';

getDb().pragma('optimize');
console.log('Database schema is ready.');
