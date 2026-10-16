// Loaded before every integration test file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '..', '.env');
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!.replace(/\/vcms(\?|$)/, '/vcms_test$1');
process.env.STORAGE_LOCAL_DIR = join(__dirname, '..', 'storage-test');
process.env.APP_URL = 'http://localhost:3000';
