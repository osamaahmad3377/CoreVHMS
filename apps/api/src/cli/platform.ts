/**
 * Multi-clinic hosting from the command line.
 *
 *   platform migrate                                   update the platform database and every clinic database
 *   platform create-admin --email a@b.c --name "Name"  add a super admin (prints a temporary password once)
 *   platform add-existing --address demo --database vcms [--name "Clinic"]
 *                                                      host an existing clinic database at demo.<BASE_DOMAIN>
 *   platform list                                      list hosted clinics
 *
 * Development: npm run platform -w @vcms/api -- <command>.  Docker image: node dist/cli/platform.js <command>.
 */
/* eslint-disable no-console -- command-line output */
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { generateTemporaryPassword, hashPassword } from '../common/crypto/password';
import { addressFor, platformHost, RESERVED_SLUGS, SLUG_PATTERN } from '../common/tenancy/hosts';
import { controlDatabaseName, databaseExists, databaseUrl, migrateDatabase } from '../common/tenancy/tenant-databases';

const TEMP_PASSWORD_DAYS = 7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function requireMultiClinic() {
  if (!env().BASE_DOMAIN) throw new Error('BASE_DOMAIN is not set: multi-clinic hosting is switched off.');
}

async function migrate(control: PrismaClient) {
  console.log(`→ Platform database ${controlDatabaseName()}`);
  console.log((await migrateDatabase(controlDatabaseName())).trim().split('\n').pop());
  if (!env().BASE_DOMAIN) return;
  const tenants = await control.tenant.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, orderBy: { slug: 'asc' } });
  let failed = 0;
  for (const t of tenants) {
    process.stdout.write(`→ ${t.slug} (${t.databaseName}): `);
    try {
      console.log((await migrateDatabase(t.databaseName)).trim().split('\n').pop());
    } catch (e) {
      failed++;
      console.log(`FAILED\n${(e as Error).message}`);
    }
  }
  console.log(`${tenants.length - failed} of ${tenants.length} clinic databases up to date.`);
  if (failed) process.exitCode = 1;
}

async function createAdmin(control: PrismaClient) {
  requireMultiClinic();
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) throw new Error('Usage: create-admin --email you@example.com --name "Your Name"');
  const password = generateTemporaryPassword();
  const data = {
    name,
    isPlatformAdmin: true,
    status: 'ACTIVE' as const,
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
    mustChangePassword: true,
    temporaryPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000),
    failedLoginCount: 0,
    lockedUntil: null,
  };
  const user = await control.user.upsert({ where: { email }, create: { email, ...data }, update: data });
  await control.auditEvent.create({ data: { action: 'platform.admin_created', entityType: 'User', entityId: user.id, summary: `${email} (command line)`, actorName: 'Command line' } });
  console.log(`Super admin ready. Sign in at ${addressFor(env().PLATFORM_SUBDOMAIN)} (${platformHost()})`);
  console.log(`  Email:              ${email}`);
  console.log(`  Temporary password: ${password}`);
  console.log(`They must choose their own password at first sign-in. Unused, it expires in ${TEMP_PASSWORD_DAYS} days.`);
}

async function addExisting(control: PrismaClient) {
  requireMultiClinic();
  const slug = arg('address')?.trim().toLowerCase() ?? '';
  const databaseName = arg('database')?.trim() ?? '';
  if (!SLUG_PATTERN.test(slug) || RESERVED_SLUGS.has(slug)) throw new Error('--address must be 3–30 lowercase letters, numbers or hyphens and not reserved');
  if (!databaseName) throw new Error('Usage: add-existing --address demo --database vcms [--name "Clinic name"]');
  if (databaseName === controlDatabaseName()) throw new Error('That is the platform database. Point DATABASE_URL at a new, empty database for the platform first.');
  if (!(await databaseExists(control, databaseName))) throw new Error(`Database ${databaseName} does not exist`);
  if (await control.tenant.findFirst({ where: { OR: [{ slug }, { databaseName }] } })) throw new Error('That address or database is already hosted');

  console.log(`→ Updating ${databaseName}`);
  await migrateDatabase(databaseName);
  const clinic = new PrismaClient({ datasources: { db: { url: databaseUrl(databaseName) } } });
  try {
    const orgs = await clinic.organization.findMany({ orderBy: { createdAt: 'asc' } });
    if (!orgs.length) throw new Error(`${databaseName} has no organization`);
    const owner = await clinic.membership.findFirst({
      where: { organizationId: orgs[0].id, roles: { some: { role: { key: 'owner' } } } },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    const t = await control.tenant.create({
      data: {
        slug,
        databaseName,
        name: arg('name')?.trim() || orgs[0].name,
        status: 'ACTIVE',
        country: orgs[0].country,
        branchName: '—',
        ownerName: owner?.user.name ?? '—',
        ownerEmail: owner?.user.email ?? '—',
        ownerAccess: 'TEMPORARY_PASSWORD',
        organizationId: orgs[0].id,
        provisionedAt: new Date(),
      },
    });
    await control.auditEvent.create({ data: { action: 'platform.clinic_added_existing', entityType: 'Tenant', entityId: t.id, summary: `${slug} → ${databaseName}`, actorName: 'Command line' } });
    console.log(`Hosted: ${addressFor(slug)} → ${databaseName}${orgs.length > 1 ? ` (${orgs.length} organizations in this database)` : ''}`);
  } finally {
    await clinic.$disconnect();
  }
}

async function list(control: PrismaClient) {
  const rows = await control.tenant.findMany({ orderBy: { slug: 'asc' } });
  if (!rows.length) console.log('No clinics yet.');
  for (const t of rows) console.log(`${t.status.padEnd(12)} ${addressFor(t.slug).padEnd(45)} ${t.databaseName.padEnd(28)} ${t.name}`);
}

async function main() {
  const command = process.argv[2];
  const commands: Record<string, (c: PrismaClient) => Promise<void>> = { migrate, 'create-admin': createAdmin, 'add-existing': addExisting, list };
  const fn = commands[command ?? ''];
  if (!fn) {
    console.log('Commands: migrate | create-admin --email --name | add-existing --address --database [--name] | list');
    process.exitCode = command ? 1 : 0;
    return;
  }
  // `migrate` must work before the platform tables exist.
  const control = new PrismaClient();
  try {
    await fn(control);
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
