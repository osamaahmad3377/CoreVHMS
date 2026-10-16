import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Migrates the test database and wipes all data before the integration suite runs. */
export default async function globalSetup() {
  require('./env');
  const url = process.env.DATABASE_URL!;
  if (!/vcms_test/.test(url)) throw new Error(`Refusing to run integration tests against non-test database: ${url}`);
  execSync('npx prisma migrate deploy', { cwd: join(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  // TRUNCATE bypasses the append-only audit trigger (row-level), which is intended for tests only.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await prisma.$disconnect();
}
