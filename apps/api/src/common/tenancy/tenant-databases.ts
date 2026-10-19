import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

const run = promisify(execFile);
const DB_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Database name for a clinic subdomain (hyphens become underscores; slugs never contain underscores). */
export function tenantDatabaseName(slug: string): string {
  return `${env().TENANT_DB_PREFIX}${slug.replace(/-/g, '_')}`;
}

/** Connection URL for another database on the same server as DATABASE_URL. */
export function databaseUrl(databaseName: string, opts: { pool?: number } = {}): string {
  if (!DB_NAME.test(databaseName)) throw new Error(`Invalid database name: ${databaseName}`);
  const url = new URL(env().DATABASE_URL);
  url.pathname = `/${databaseName}`;
  if (opts.pool) url.searchParams.set('connection_limit', String(opts.pool));
  return url.toString();
}

/** Name of the database DATABASE_URL points at. */
export function controlDatabaseName(): string {
  return decodeURIComponent(new URL(env().DATABASE_URL).pathname.slice(1));
}

export async function databaseExists(client: PrismaClient, databaseName: string): Promise<boolean> {
  const rows = await client.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${databaseName}`;
  return rows.length > 0;
}

/** Creates an empty database (no-op if it exists). The DATABASE_URL user needs the CREATEDB privilege. */
export async function createDatabase(client: PrismaClient, databaseName: string): Promise<boolean> {
  if (!DB_NAME.test(databaseName)) throw new Error(`Invalid database name: ${databaseName}`);
  if (await databaseExists(client, databaseName)) return false;
  // Identifiers cannot be bound as parameters; the name is validated above.
  await client.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  return true;
}

function schemaPath(): string {
  const candidates = [process.env.PRISMA_SCHEMA_PATH, resolve(__dirname, '../../../prisma/schema.prisma'), join(process.cwd(), 'prisma/schema.prisma')];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('Cannot find prisma/schema.prisma (set PRISMA_SCHEMA_PATH)');
  return found;
}

/** Applies all pending migrations to one database with the Prisma CLI (same as `prisma migrate deploy`). */
export async function migrateDatabase(databaseName: string): Promise<string> {
  const cli = require.resolve('prisma/build/index.js');
  try {
    const { stdout } = await run(process.execPath, [cli, 'migrate', 'deploy', '--schema', schemaPath()], {
      env: { ...process.env, DATABASE_URL: databaseUrl(databaseName) },
      timeout: 10 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message: string };
    const detail = (err.stderr || err.stdout || err.message).trim().split('\n').slice(-6).join('\n');
    throw new Error(`Database update failed for ${databaseName}: ${detail}`);
  }
}
