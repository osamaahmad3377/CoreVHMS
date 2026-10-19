import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/crypto/password';
import { RequestContext } from '../src/common/context/request-context';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenancyService } from '../src/common/tenancy/tenancy.service';
import { resetEnvCache } from '../src/config/env';
import { PlatformClinicsService } from '../src/modules/platform/platform-clinics.service';
import { PASSWORD, TestClient, closeApp, getApp, mail, makeClient, prisma, unique } from './helpers';

// Multi-clinic hosting: every clinic gets its own database, reached through its subdomain.
const BASE = 'vcms.test';
const PREFIX = 'vcms_test_t_';
const SETUP_MS = 180_000;
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

async function dropClinicDatabases() {
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const rows = await admin.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${PREFIX + '%'}`;
  for (const r of rows) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${r.datname}" WITH (FORCE)`);
  await admin.$disconnect();
}

describe('Multi-clinic hosting', () => {
  let app: INestApplication;
  let superAdmin: TestClient;
  const at = (sub: string) => `${sub}.${BASE}`;
  const client = (sub: string) => Object.assign(new TestClient(app), { host: at(sub) });

  /** Waits for the background set-up to finish and returns the clinic as listed. */
  async function settled(id: string) {
    await app.get(PlatformClinicsService).settled(id);
    return (await superAdmin.get(`/platform/clinics/${id}`)).body;
  }

  beforeAll(async () => {
    process.env.BASE_DOMAIN = BASE;
    process.env.TENANT_DB_PREFIX = PREFIX;
    resetEnvCache();
    await dropClinicDatabases();
    app = await getApp();
    await prisma().user.create({
      data: { email: 'root@nextcore.test', name: 'Platform Root', isPlatformAdmin: true, passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date() },
    });
    superAdmin = client('admin');
    expect((await superAdmin.login('root@nextcore.test')).status).toBe(200);
  }, SETUP_MS);

  afterAll(async () => {
    await closeApp();
    await dropClinicDatabases();
    delete process.env.BASE_DOMAIN;
    delete process.env.TENANT_DB_PREFIX;
    resetEnvCache();
  }, SETUP_MS);

  it('tells each address what it is, and serves no clinic data outside a clinic address', async () => {
    expect((await client('admin').get('/tenant')).body).toEqual({ mode: 'platform', baseDomain: BASE });
    const root = Object.assign(new TestClient(app), { host: BASE });
    expect((await root.get('/tenant')).body).toEqual({ mode: 'root', baseDomain: BASE });
    expect((await root.post('/auth/login', { email: 'root@nextcore.test', password: PASSWORD })).body.error.code).toBe('CLINIC_NOT_FOUND');
    expect((await client('nosuchclinic').get('/clients')).status).toBe(404);
    expect((await client('nosuchclinic').get('/tenant/lookup?address=nosuchclinic')).body).toEqual({ found: false });
    // Self-registration is closed: clinics are added by the super admin.
    expect((await client('nosuchclinic').post('/auth/register', {})).status).toBe(404);
  });

  it('only platform administrators can sign in at the super admin address, and they see no clinic data', async () => {
    await prisma().user.create({ data: { email: 'someone@nextcore.test', name: 'Not Admin', passwordHash: await hashPassword(PASSWORD) } });
    expect((await client('admin').login('someone@nextcore.test')).status).toBe(401);
    expect(superAdmin.session.platform).toBe(true);
    expect(superAdmin.session.permissions).toEqual(['platform.clinics.manage']);
    expect((await superAdmin.get('/clients')).status).toBe(403);
  });

  it('validates new clinic addresses', async () => {
    const base = { name: 'X Clinic', country: 'PK', branchName: 'Main', ownerName: 'Owner', ownerEmail: 'o@x.test', ownerAccess: 'TEMPORARY_PASSWORD' };
    expect((await superAdmin.post('/platform/clinics', { ...base, slug: 'Bad_Address' })).status).toBe(400);
    expect((await superAdmin.post('/platform/clinics', { ...base, slug: 'admin' })).body.error.code).toBe('ADDRESS_RESERVED');
  });

  let alpha: { id: string; password: string; owner: TestClient };

  it('adds a clinic: creates its database, sets it up and gives the owner a temporary password', async () => {
    const body = {
      name: 'Alpha Paws',
      slug: 'alpha-paws',
      country: 'PK',
      branchName: 'Lahore — Gulberg',
      ownerName: 'Ali Owner',
      ownerEmail: 'ali@alpha.test',
      ownerAccess: 'TEMPORARY_PASSWORD',
    };
    const res = await superAdmin.post('/platform/clinics', body);
    expect(res.status).toBe(201);
    expect(res.body.clinic).toMatchObject({ slug: 'alpha-paws', status: 'PROVISIONING', databaseName: `${PREFIX}alpha_paws`, address: 'http://alpha-paws.vcms.test:3000' });
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    const ready = await settled(res.body.clinic.id);
    expect(ready).toMatchObject({ status: 'ACTIVE', lastError: null });
    expect((await superAdmin.post('/platform/clinics', { ...body, name: 'Another' })).status).toBe(409);

    // The temporary password is never kept once the clinic is set up.
    const row = await prisma().tenant.findUniqueOrThrow({ where: { id: res.body.clinic.id } });
    expect(row.ownerPasswordHash).toBeNull();
    expect((await client('alpha-paws').get('/tenant')).body).toMatchObject({ mode: 'clinic', baseDomain: BASE, clinic: { name: 'Alpha Paws', status: 'ACTIVE', branding: { brandName: 'Alpha Paws' } } });
    expect((await client('admin').get('/tenant/lookup?address=alpha-paws')).body).toEqual({ found: true, address: 'http://alpha-paws.vcms.test:3000' });

    const owner = client('alpha-paws');
    expect((await owner.login('ali@alpha.test', res.body.temporaryPassword)).status).toBe(200);
    expect(owner.session.user.mustChangePassword).toBe(true);
    expect((await owner.post('/auth/change-password', { currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })).status).toBe(204);
    expect((await owner.login('ali@alpha.test')).status).toBe(200);
    expect(owner.session.organization).toMatchObject({ name: 'Alpha Paws', country: 'PK', currency: 'PKR' });
    expect(owner.session.branch.name).toBe('Lahore — Gulberg');
    expect(owner.session.platform).toBe(false);
    expect((await owner.get('/services')).body.map((s: any) => s.name)).toEqual(expect.arrayContaining(['Consultation', 'Vaccination']));
    expect((await owner.get('/platform/clinics')).status).toBe(403);
    // The clinic owner's account lives only in the clinic's database.
    expect(await prisma().user.findUnique({ where: { email: 'ali@alpha.test' } })).toBeNull();
    alpha = { id: res.body.clinic.id, password: PASSWORD, owner };
  }, SETUP_MS);

  it('keeps clinics apart: separate databases, accounts and records', async () => {
    const res = await superAdmin.post('/platform/clinics', {
      name: 'Bondi Vets',
      slug: 'bondi',
      country: 'AU',
      branchName: 'Bondi Junction',
      ownerName: 'Bea Owner',
      ownerEmail: 'bea@bondi.test',
      ownerAccess: 'INVITATION',
    });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeNull();
    expect((await settled(res.body.clinic.id)).status).toBe('ACTIVE');

    // The owner chooses a password from the emailed link, which points at the clinic's own address.
    const msg = mail().outbox.filter((m) => m.to === 'bea@bondi.test').pop()!;
    expect(msg.text).toContain('http://bondi.vcms.test:3000/accept-invite?token=');
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(msg.text)![1]);
    const bea = client('bondi');
    expect((await bea.post('/auth/invitations/accept', { token, name: 'Bea Owner', password: PASSWORD })).status).toBe(200);
    expect((await bea.get('/auth/session')).body.organization).toMatchObject({ name: 'Bondi Vets', currency: 'AUD' });

    const alphaClient = await makeClient(alpha.owner, { lastName: unique('Alpha') });
    expect((await alpha.owner.get(`/clients/${alphaClient.id}`)).status).toBe(200);
    expect((await bea.get(`/clients/${alphaClient.id}`)).status).toBe(404);
    expect((await bea.get('/clients')).body.meta.total).toBe(0);

    // An account from one clinic does not exist at another clinic's address, and a session cookie is useless there.
    expect((await client('bondi').login('ali@alpha.test')).status).toBe(401);
    const stolen = Object.assign(new TestClient(app), { host: at('bondi'), cookies: alpha.owner.cookies, csrf: alpha.owner.csrf });
    expect((await stolen.get('/clients')).status).toBe(401);

    // Each clinic's sign-in page shows its own branding, before anyone signs in, and never another clinic's.
    await alpha.owner.call('put', '/organization/branding', { brandName: 'Alpha', primaryColor: '#dc2626' });
    const logo = await alpha.owner.upload('/attachments', { entityType: 'Branding', entityId: alpha.owner.session.organization.id, category: 'logo' }, { buffer: PNG, name: 'logo.png', type: 'image/png' });
    expect((await alpha.owner.post('/organization/logo', { attachmentId: logo.body.id })).status).toBe(200);
    const anonymousAlpha = client('alpha-paws');
    const alphaInfo = (await anonymousAlpha.get('/tenant')).body;
    expect(alphaInfo.clinic.branding).toMatchObject({ brandName: 'Alpha', primaryColor: '#dc2626', logoUrl: expect.stringMatching(/^\/api\/v1\/tenant\/logo\?v=/) });
    const publicLogo = await anonymousAlpha.get('/tenant/logo');
    expect(publicLogo.status).toBe(200);
    expect(publicLogo.headers['content-type']).toBe('image/png');
    expect((await client('bondi').get('/tenant')).body.clinic.branding).toMatchObject({ brandName: 'Bondi Vets', primaryColor: null, logoUrl: null });
    expect((await client('bondi').get('/tenant/logo')).status).toBe(404);
    expect((await client('admin').get('/tenant/logo')).status).toBe(404);

    // Background jobs visit every clinic database.
    const seen: string[] = [];
    await app.get(TenancyService).forEachDatabase('test', async () => {
      seen.push((await app.get(PrismaService).raw.organization.findFirstOrThrow()).name);
    });
    expect(seen.sort()).toEqual(['Alpha Paws', 'Bondi Vets']);
  }, SETUP_MS);

  it('shows a clinic at a glance: usage counts from its own database and its history', async () => {
    const o = (await superAdmin.get(`/platform/clinics/${alpha.id}/overview`)).body;
    expect(o.clinic).toMatchObject({ slug: 'alpha-paws', status: 'ACTIVE' });
    expect(o.usage).toMatchObject({ staff: 1, activeStaff: 1, clients: 1, patients: 0, appointmentsThisMonth: 0 });
    expect(o.usage.lastSignInAt).toEqual(expect.any(String));
    expect(o.events.map((e: any) => e.action)).toEqual(expect.arrayContaining(['platform.clinic_created', 'platform.clinic_ready']));
    expect((await alpha.owner.get(`/platform/clinics/${alpha.id}/overview`)).status).toBe(403);
  });

  it('pauses and reactivates a clinic without losing data', async () => {
    expect((await superAdmin.post(`/platform/clinics/${alpha.id}/suspend`)).body.status).toBe('SUSPENDED');
    const blocked = await alpha.owner.get('/clients');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CLINIC_SUSPENDED');
    expect((await client('alpha-paws').get('/tenant')).body.clinic.status).toBe('SUSPENDED');
    expect((await superAdmin.post(`/platform/clinics/${alpha.id}/suspend`)).status).toBe(422);

    expect((await superAdmin.post(`/platform/clinics/${alpha.id}/reactivate`)).body.status).toBe('ACTIVE');
    expect((await alpha.owner.get('/clients')).status).toBe(200);
  });

  it('gives a clinic owner a new temporary password', async () => {
    const res = await superAdmin.post(`/platform/clinics/${alpha.id}/owner-password`);
    expect(res.status).toBe(200);
    expect((await alpha.owner.get('/clients')).status).toBe(401); // old sign-ins end
    const owner = client('alpha-paws');
    expect((await owner.login('ali@alpha.test', res.body.temporaryPassword)).status).toBe(200);
    expect(owner.session.user.mustChangePassword).toBe(true);
    const events = await prisma().auditEvent.findMany({ where: { entityId: alpha.id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining(['platform.clinic_created', 'platform.clinic_ready', 'platform.clinic_suspended', 'platform.clinic_reactivated', 'platform.clinic_owner_password_reset']),
    );
  });

  it('records a failed set-up and can try again', async () => {
    const svc = app.get(PlatformClinicsService);
    const t = await prisma().tenant.create({
      data: { slug: 'broken', name: 'Broken', databaseName: 'bad name!', country: 'PK', branchName: 'Main', ownerName: 'O', ownerEmail: 'o@broken.test', ownerAccess: 'INVITATION' },
    });
    await RequestContext.run({ requestId: 't', permissions: new Set(), platform: true }, () => svc.provision(t.id));
    const failed = (await superAdmin.get(`/platform/clinics/${t.id}`)).body;
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('Invalid database name');
    expect((await client('broken').get('/clients')).body.error.code).toBe('CLINIC_NOT_READY');

    await prisma().tenant.update({ where: { id: t.id }, data: { databaseName: `${PREFIX}broken` } });
    expect((await superAdmin.post(`/platform/clinics/${t.id}/retry`)).status).toBe(200);
    expect((await settled(t.id)).status).toBe('ACTIVE');
  }, SETUP_MS);
});
