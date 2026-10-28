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
    expect(superAdmin.session.permissions.sort()).toEqual(['platform.billing.manage', 'platform.clinics.manage', 'platform.plans.manage']);
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

  describe('plans and limits', () => {
    const setPlan = (id: string, body: Record<string, unknown>) => superAdmin.call('put', `/platform/clinics/${id}/plan`, body);
    const planByName = async (name: string) => ((await superAdmin.get('/platform/plans')).body as any[]).find((p) => p.name === name);
    const invite = async (owner: TestClient) => {
      const roles = (await owner.get('/roles')).body as any[];
      const role = roles.find((r) => r.key === 'receptionist');
      const n = unique('staff');
      return owner.post('/staff/invite', { email: `${n}@limits.test`, name: 'Limit Test', roleIds: [role.id], branchIds: [owner.session.branch.id], isClinician: false });
    };
    let starter: any;
    let lc: { id: string; owner: TestClient };

    // Its own clinic, so these tests do not depend on what happened to the others.
    beforeAll(async () => {
      const body = { name: 'Limits Vets', slug: 'limits-vets', country: 'PK', branchName: 'Main branch', ownerName: 'Lena Limits', ownerEmail: 'lena@limits-vets.test', ownerAccess: 'TEMPORARY_PASSWORD' };
      const res = await superAdmin.post('/platform/clinics', body);
      expect((await settled(res.body.clinic.id)).status).toBe('ACTIVE');
      const owner = client('limits-vets');
      expect((await owner.login('lena@limits-vets.test', res.body.temporaryPassword)).status).toBe(200);
      expect((await owner.post('/auth/change-password', { currentPassword: res.body.temporaryPassword, newPassword: PASSWORD })).status).toBe(204);
      expect((await owner.login('lena@limits-vets.test')).status).toBe(200);
      lc = { id: res.body.clinic.id, owner };
    }, SETUP_MS);

    it('starts with the starter plans, and plan management belongs to the super admin only', async () => {
      const plans = (await superAdmin.get('/platform/plans')).body as any[];
      expect(plans.map((p) => p.name)).toEqual(['Starter', 'Professional', 'Premium']);
      expect(plans[0]).toMatchObject({ maxStaff: 2, maxBranches: 1, maxAutomations: 5, features: ['branding', 'mailbox'], isActive: true });
      expect(plans[1]).toMatchObject({ maxStaff: 6, maxBranches: 2, maxAutomations: 9 });
      expect(plans[2]).toMatchObject({ maxStaff: null, maxBranches: 3, maxAutomations: null });
      starter = plans[0];
      expect((await lc.owner.get('/platform/plans')).status).toBe(403);
      expect((await lc.owner.call('put', `/platform/clinics/${lc.id}/plan`, { planId: starter.id })).status).toBe(403);
      // A clinic without a plan has no limits.
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: null, maxStaff: null, maxBranches: null });
      expect((await lc.owner.get('/auth/session')).body.permissions).toContain('lab.read');
    });

    it('closes the areas a plan does not include, for everyone in the clinic', async () => {
      const r = await setPlan(lc.id, { planId: starter.id });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ planName: 'Starter', entitlements: { maxStaff: 2, maxBranches: 1, features: ['branding', 'mailbox'] } });
      const session = (await lc.owner.get('/auth/session')).body;
      expect(session.entitlements).toMatchObject({ planName: 'Starter', maxStaff: 2, features: ['branding', 'mailbox'] });
      expect(session.permissions).not.toContain('lab.read');
      expect(session.permissions).toContain('branding.manage');
      expect(session.organization.enabledModules).not.toContain('lab');
      const lab = await lc.owner.get('/lab-orders');
      expect(lab.status).toBe(403);
      expect(lab.body.error.code).toBe('PLAN_FEATURE');
      expect(lab.body.error.message).toContain('Starter plan');
      expect(lab.body.error.message).toContain('Upgrade to Professional or Premium');
      expect(session.entitlements.offers.map((p: { name: string }) => p.name)).toEqual(['Starter', 'Professional', 'Premium']);
      expect((await lc.owner.call('put', '/organization/branding', { primaryColor: '#dc2626' })).status).toBe(200);
      // The newer plan areas: stock forecast and branch transfers. The clinic's own mailbox is in Starter.
      expect((await lc.owner.get('/stock/forecast')).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'forecast' } });
      expect((await lc.owner.post('/stock/branch-transfers', { productId: lc.id, fromBranchId: lc.id, toBranchId: lc.id, quantity: 1 })).body.error.code).toBe('PLAN_FEATURE');
      expect(session.entitlements.features).toContain('mailbox');
      // WhatsApp Business is off on Starter: it cannot be connected, and nothing is sent by WhatsApp.
      const wa = { phoneNumberId: '123456789', businessAccountId: '987654321', accessToken: 'x'.repeat(40) };
      expect((await lc.owner.call('put', '/integrations/whatsapp', wa)).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'whatsapp' } });
      expect((await lc.owner.get('/integrations/whatsapp')).status).toBe(200);
      // The plan page offers the plans to compare.
      expect((await lc.owner.get('/organization/plan')).body.plans.map((p: any) => p.name)).toEqual(['Starter', 'Professional', 'Premium']);
      expect((await lc.owner.get('/reports/clinical')).body.error.code).toBe('PLAN_FEATURE');
      // Everything else keeps working.
      expect((await lc.owner.get('/clients')).status).toBe(200);
      expect((await lc.owner.get('/setup/modules')).body.locked).toEqual(expect.arrayContaining(['lab', 'hospital', 'surgery']));
    });

    it('lets a clinic switch on only as many automations as its plan allows', async () => {
      expect(starter.maxAutomations).toBe(5);
      // The basic automations arrive with only the plan's number switched on.
      const list = (await lc.owner.get('/automations')).body as any[];
      expect(list).toHaveLength(13);
      expect(list.filter((a) => a.isActive).map((a) => a.name)).toEqual(expect.arrayContaining(['Appointment booked confirmation', 'Appointment reminder the day before']));
      expect(list.filter((a) => a.isActive)).toHaveLength(5);
      expect((await lc.owner.get('/organization/plan')).body).toMatchObject({ usage: { automations: 5 }, entitlements: { maxAutomations: 5 } });
      const off = list.find((a) => !a.isActive);
      const over = await lc.owner.patch(`/automations/${off.id}/active`, { isActive: true });
      expect(over.status).toBe(422);
      expect(over.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { kind: 'automations', limit: 5, current: 5 } });
      expect(over.body.error.message).toContain('Switch one off');
      // Swapping is fine: switch one off, then another on.
      const on = list.find((a) => a.isActive);
      expect((await lc.owner.patch(`/automations/${on.id}/active`, { isActive: false })).status).toBe(200);
      expect((await lc.owner.patch(`/automations/${off.id}/active`, { isActive: true })).status).toBe(200);
      // A ready-made recipe added again counts as ready-made: no room while 5 are on. Saved as "off" is always allowed.
      const draft = { name: 'Extra', isActive: true, trigger: 'PAYMENT_RECEIVED', conditions: [], steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Thanks', body: 'Thank you {{clientName}}' }] };
      expect((await lc.owner.post('/automations', { ...draft, recipeKey: 'payment' })).body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { kind: 'automations' } });
      // The clinic's own automations have their own limit (3 on Starter).
      for (let i = 1; i <= 3; i++) expect((await lc.owner.post('/automations', { ...draft, name: `Own ${i}` })).status).toBe(201);
      const fourth = await lc.owner.post('/automations', { ...draft, name: 'Own 4' });
      expect(fourth.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { kind: 'customAutomations', limit: 3, current: 3 } });
      expect(fourth.body.error.message).toContain('upgrade to Professional or Premium');
      expect((await lc.owner.post('/automations', { ...draft, name: 'Own 4', isActive: false })).status).toBe(201);
      expect((await lc.owner.get('/organization/plan')).body.usage).toMatchObject({ automations: 5, customAutomations: 3 });
      // Without the full builder: easy or ready-made shapes only, and their wording can always change.
      const withCheck = { ...draft, isActive: false, steps: [{ type: 'WAIT_UNTIL', hour: 10 }, ...draft.steps] };
      expect((await lc.owner.post('/automations', withCheck)).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'automationBuilder' } });
      expect((await lc.owner.post('/automations', { ...draft, isActive: false, marketing: true })).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'marketing' } });
      const basic = (await lc.owner.get(`/automations/${on.id}`)).body;
      const edited = await lc.owner.call('put', `/automations/${on.id}`, { ...basic, description: basic.description ?? '', steps: (basic.steps as any[]).map((st) => (st.type === 'SEND_MESSAGE' ? { ...st, body: `${st.body} See you soon!` } : st)) });
      expect(edited.status).toBe(200);
      const grown = await lc.owner.call('put', `/automations/${on.id}`, { ...basic, description: basic.description ?? '', steps: [...basic.steps, { type: 'EMAIL_TEAM', to: 'team@x.test', subject: 'Hi', body: 'Hi' }] });
      expect(grown.body.error.code).toBe('PLAN_FEATURE');
    });

    it('stops adding staff and branches beyond the plan, but never removes anyone', async () => {
      expect((await invite(lc.owner)).status).toBe(201); // owner + 1 = 2 of 2
      const over = await invite(lc.owner);
      expect(over.status).toBe(422);
      expect(over.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { kind: 'staff', limit: 2, current: 2 } });
      expect(over.body.error.message).toContain('allows 2 staff accounts');
      const branch = await lc.owner.post('/branches', { name: 'Second branch', code: 'SEC', timezone: 'Asia/Karachi' });
      expect(branch.status).toBe(422);
      expect(branch.body.error).toMatchObject({ code: 'PLAN_LIMIT', details: { kind: 'branches', limit: 1 } });
      expect((await lc.owner.get('/organization/plan')).body).toMatchObject({ usage: { staff: 2, branches: 1 }, entitlements: { maxStaff: 2 } });
      const o = (await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body;
      expect(o.usage).toMatchObject({ staffCounted: 2, branches: 1 });
      expect(o.clinic.entitlements.maxStaff).toBe(2);
    });

    it('applies exceptions for one clinic: a higher limit, an added feature, a feature taken away', async () => {
      const r = await setPlan(lc.id, { planId: starter.id, staffLimitOverride: 5, branchLimitOverride: 2, extraFeatures: ['lab'] });
      expect(r.body.entitlements).toMatchObject({ maxStaff: 5, maxBranches: 2, features: ['lab', 'branding', 'mailbox'] });
      expect((await invite(lc.owner)).status).toBe(201);
      expect((await lc.owner.post('/branches', { name: 'Second branch', code: 'SEC', timezone: 'Asia/Karachi' })).status).toBe(201);
      expect((await lc.owner.get('/lab-orders')).status).toBe(200);
      // The plan itself is unchanged for other clinics.
      expect((await planByName('Starter')).features).toEqual(['branding', 'mailbox']);
      // WhatsApp Business switched on for this Starter clinic only.
      expect((await lc.owner.post('/integrations/whatsapp/verify', {})).body.error.code).toBe('PLAN_FEATURE');
      const wa = await setPlan(lc.id, { planId: starter.id, staffLimitOverride: 5, branchLimitOverride: 2, extraFeatures: ['lab', 'whatsapp'] });
      expect(wa.body.entitlements.features).toEqual(['lab', 'branding', 'whatsapp', 'mailbox']);
      expect((await lc.owner.post('/integrations/whatsapp/verify', {})).body.error?.code).not.toBe('PLAN_FEATURE');
      // Taking away a feature the plan has.
      const hospital = await planByName('Premium');
      const h = await setPlan(lc.id, { planId: hospital.id, removedFeatures: ['surgery'] });
      expect(h.body.entitlements.features).toEqual(expect.arrayContaining(['hospital', 'lab', 'reports']));
      expect(h.body.entitlements.features).not.toContain('surgery');
      expect((await lc.owner.get('/surgeries')).body.error.code).toBe('PLAN_FEATURE');
      expect((await lc.owner.get('/admissions')).status).toBe(200);
      expect((await setPlan(lc.id, { planId: hospital.id, extraFeatures: ['lab'], removedFeatures: ['lab'] })).body.error.code).toBe('FEATURE_CONFLICT');
      // Marketing: only Professional and Premium have it; the admin can give it to one clinic or take it away.
      expect((await planByName('Starter')).features).not.toContain('marketing');
      expect((await planByName('Professional')).features).toContain('marketing');
      expect((await planByName('Premium')).features).toContain('marketing');
      const promo = { name: 'Admin-switched offer', isActive: false, marketing: true, trigger: 'PAYMENT_RECEIVED', conditions: [], steps: [{ type: 'SEND_MESSAGE', channel: 'BEST', subject: 'Offer', body: 'Hi {{clientName}}' }] };
      expect((await setPlan(lc.id, { planId: starter.id })).body.entitlements.features).not.toContain('marketing');
      expect((await lc.owner.post('/automations', promo)).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'marketing' } });
      expect((await setPlan(lc.id, { planId: starter.id, extraFeatures: ['marketing'] })).body.entitlements.features).toContain('marketing');
      const made = await lc.owner.post('/automations', promo);
      expect(made.status).toBe(201);
      expect((await lc.owner.get('/automations/options')).status).toBe(200);
      const off = await setPlan(lc.id, { planId: hospital.id, removedFeatures: ['marketing'] });
      expect(off.body.entitlements.features).not.toContain('marketing');
      expect((await lc.owner.post('/automations', { ...promo, name: 'Another offer' })).body.error).toMatchObject({ code: 'PLAN_FEATURE', details: { feature: 'marketing' } });
      expect((await lc.owner.call('put', '/automations/marketing-settings', { approval: true })).body.error?.code).toBe('PLAN_FEATURE');
      await lc.owner.call('delete', `/automations/${made.body.id}`);
    });

    it('a lowered limit keeps what the clinic has but allows nothing more', async () => {
      const r = await setPlan(lc.id, { planId: starter.id, staffLimitOverride: 2 });
      expect(r.body.entitlements.maxStaff).toBe(2);
      expect((await lc.owner.get('/clients')).status).toBe(200); // nobody is locked out
      const over = await invite(lc.owner);
      expect(over.body.error.code).toBe('PLAN_LIMIT');
      // Pausing someone frees a place only below the limit; reactivating is counted too.
      const staff = ((await lc.owner.get('/staff')).body.data ?? (await lc.owner.get('/staff')).body) as any[];
      const other = staff.find((m) => m.user.email.endsWith('@limits.test') && m.status === 'ACTIVE') ?? staff.find((m) => m.user.email.endsWith('@limits.test'));
      expect((await lc.owner.patch(`/staff/${other.id}`, { status: 'SUSPENDED' })).status).toBe(200);
      const back = await lc.owner.patch(`/staff/${other.id}`, { status: 'ACTIVE' });
      expect(back.status).toBe(422);
      expect(back.body.error.code).toBe('PLAN_LIMIT');
    });

    it('records plan changes in the clinic history and rejects switched-off plans', async () => {
      const events = (await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body.events as any[];
      const changed = events.filter((e) => e.action === 'platform.clinic_plan_changed');
      expect(changed.length).toBeGreaterThanOrEqual(4);
      expect(changed[changed.length - 1].summary).toContain('No plan → Starter');

      const custom = (await superAdmin.post('/platform/plans', { name: 'Custom', description: null, priceMonthlyMinor: 0, currency: 'PKR', maxStaff: null, maxBranches: null, features: ['lab'], isActive: false, sortOrder: 9 })).body;
      expect((await setPlan(lc.id, { planId: custom.id })).body.error.code).toBe('PLAN_UNAVAILABLE');
      expect((await superAdmin.post('/platform/plans', { name: 'Custom', maxStaff: null, maxBranches: null, features: [], priceMonthlyMinor: 0 })).status).toBe(409);
      expect((await superAdmin.post('/platform/plans', { name: 'Bad', maxStaff: 0, maxBranches: null, features: [], priceMonthlyMinor: 0 })).status).toBe(400);
      expect((await superAdmin.post('/platform/plans', { name: 'Bad2', maxStaff: null, maxBranches: null, features: ['teleport'], priceMonthlyMinor: 0 })).status).toBe(400);
      // A plan on clinics cannot be deleted; an unused one can.
      expect((await superAdmin.call('delete', `/platform/plans/${starter.id}`)).body.error.code).toBe('PLAN_IN_USE');
      expect((await superAdmin.call('delete', `/platform/plans/${custom.id}`)).status).toBe(204);
    });

    it('changing a plan changes every clinic on it at once, and a new clinic can start on a plan', async () => {
      const clinicPlan = await planByName('Professional');
      const edit = await superAdmin.call('put', `/platform/plans/${clinicPlan.id}`, { name: 'Professional', description: clinicPlan.description, priceMonthlyMinor: clinicPlan.priceMonthlyMinor, currency: 'PKR', maxStaff: 12, maxBranches: 1, features: ['lab', 'boarding', 'reports', 'branding'], isActive: true, sortOrder: 2 });
      expect(edit.body).toMatchObject({ maxStaff: 12, clinicCount: 0 });

      const created = await superAdmin.post('/platform/clinics', { name: 'Cedar Vets', slug: 'cedar', country: 'PK', branchName: 'Main branch', ownerName: 'Cara Cedar', ownerEmail: 'cara@cedar.test', ownerAccess: 'TEMPORARY_PASSWORD', planId: clinicPlan.id });
      expect(created.status).toBe(201);
      expect(created.body.clinic).toMatchObject({ planName: 'Professional' });
      expect((await settled(created.body.clinic.id)).status).toBe('ACTIVE');
      const cara = client('cedar');
      expect((await cara.login('cara@cedar.test', created.body.temporaryPassword)).status).toBe(200);
      expect(cara.session.entitlements).toMatchObject({ planName: 'Professional', maxStaff: 12, maxBranches: 1, features: ['lab', 'boarding', 'reports', 'branding'] });
      expect(cara.session.permissions).toContain('lab.read');
      expect(cara.session.permissions).not.toContain('hospital.read');

      // Raising the plan reaches the clinic without it signing in again.
      await superAdmin.call('put', `/platform/plans/${clinicPlan.id}`, { name: 'Professional', description: null, priceMonthlyMinor: 0, currency: 'PKR', maxStaff: 12, maxBranches: 1, features: ['lab', 'boarding', 'reports', 'branding', 'hospital'], isActive: true, sortOrder: 2 });
      expect((await cara.get('/auth/session')).body.permissions).toContain('hospital.read');
      // Back to no plan: nothing limited.
      await setPlan(lc.id, { planId: null });
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: null, maxStaff: null });
    });

    it('takes plan change requests from clinic owners, for the super admin to approve or dismiss', async () => {
      const starterPlan = await planByName('Starter');
      const premium = await planByName('Premium');
      await setPlan(lc.id, { planId: starterPlan.id });
      expect((await lc.owner.get('/organization/plan')).body.pendingRequest).toBeNull();
      expect((await lc.owner.post('/organization/plan/upgrade-request', { planId: premium.id, note: 'Opening a second branch' })).status).toBe(200);
      expect((await lc.owner.get('/organization/plan')).body.pendingRequest).toMatchObject({ planId: premium.id, planName: 'Premium' });
      expect((await lc.owner.get('/platform/plan-requests')).status).toBe(403);
      const requestFor = async () => ((await superAdmin.get('/platform/plan-requests')).body as any[]).filter((r) => r.clinicId === lc.id);
      // Asking again replaces the open request instead of adding another.
      expect((await lc.owner.post('/organization/plan/upgrade-request', { planId: premium.id, note: 'Second branch in March' })).status).toBe(200);
      const [req, ...more] = await requestFor();
      expect(more).toHaveLength(0);
      expect(req).toMatchObject({ clinicName: 'Limits Vets', fromPlanName: 'Starter', toPlanName: 'Premium', note: 'Second branch in March' });

      const ok = await superAdmin.post(`/platform/plan-requests/${req.id}/approve`, {});
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ planName: 'Premium' });
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: 'Premium' });
      expect((await lc.owner.get('/organization/plan')).body.pendingRequest).toBeNull();
      expect((await superAdmin.post(`/platform/plan-requests/${req.id}/approve`, {})).body.error.code).toBe('REQUEST_HANDLED');

      // Dismissed: the request closes and the plan stays as it is.
      await lc.owner.post('/organization/plan/upgrade-request', { planId: starterPlan.id });
      const [again] = await requestFor();
      expect((await superAdmin.post(`/platform/plan-requests/${again.id}/dismiss`, {})).status).toBe(204);
      expect(await requestFor()).toHaveLength(0);
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: 'Premium' });
      await setPlan(lc.id, { planId: null });
    });

    it('replaces older plans with the recommended ones, and clinics move with their plan', async () => {
      // An older set of plans: "Clinic" where Professional is now.
      const prof = await planByName('Professional');
      await superAdmin.call('put', `/platform/plans/${prof.id}`, { name: 'Clinic', description: null, priceMonthlyMinor: 1_200_000, currency: 'PKR', maxStaff: 10, maxBranches: 1, maxAutomations: null, features: ['lab'], isActive: true, sortOrder: 2 });
      await setPlan(lc.id, { planId: prof.id });
      expect((await lc.owner.post('/platform/plans/recommended', {})).status).toBe(403);
      const res = await superAdmin.post('/platform/plans/recommended', {});
      expect(res.status).toBe(200);
      expect((res.body as any[]).map((p) => p.name)).toEqual(['Starter', 'Professional', 'Premium']);
      const after = (res.body as any[]).find((p) => p.id === prof.id);
      expect(after).toMatchObject({ name: 'Professional', priceMonthlyMinor: 980_000, maxStaff: 6, maxBranches: 2, maxAutomations: 9 });
      expect(after.clinicCount).toBeGreaterThan(0);
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: 'Professional', maxStaff: 6, maxBranches: 2 });
      await setPlan(lc.id, { planId: null });
    });

    it('sells extra branches and staff on the plan, and works out the monthly bill', async () => {
      const starterPlan = await planByName('Starter');
      const billing = (body: Record<string, unknown>) => superAdmin.call('put', `/platform/clinics/${lc.id}/billing`, { billingCycle: 'MONTHLY', trialEndsAt: null, trialThenPlanId: null, ...body });
      await setPlan(lc.id, { planId: starterPlan.id });
      // Paying yearly: 10 months' price spread over 12.
      // (Earlier tests left this clinic with more staff and branches than Starter includes: those are billed as extras.)
      const start = (await billing({ billingCycle: 'YEARLY' })).body.bill;
      expect(start).toMatchObject({ planMinor: 566_667, totalMinor: 566_667 + start.extrasMinor, inTrial: false });

      expect((await lc.owner.post('/organization/plan/upgrade-request', { kind: 'EXTRA_BRANCH', quantity: 1, note: 'Opening in DHA' })).status).toBe(200);
      expect((await lc.owner.get('/organization/plan')).body.pendingRequest).toMatchObject({ kind: 'EXTRA_BRANCH', quantity: 1, planId: null });
      const [req] = ((await superAdmin.get('/platform/plan-requests')).body as any[]).filter((r) => r.clinicId === lc.id);
      expect(req).toMatchObject({ kind: 'EXTRA_BRANCH', quantity: 1, priceMonthlyMinor: 500_000, toPlanName: null });
      const ok = await superAdmin.post(`/platform/plan-requests/${req.id}/approve`, {});
      expect(ok.body).toMatchObject({ planName: 'Starter', branchLimitOverride: 2, entitlements: { maxBranches: 2 }, bill: { extraBranches: 1, extraBranchMinor: 500_000 } });
      expect(ok.body.bill.totalMinor).toBe(566_667 + 500_000 + ok.body.bill.extraStaff * 50_000);
      const view = (await lc.owner.get('/organization/plan')).body;
      expect(view).toMatchObject({ billing: { cycle: 'YEARLY', bill: { extraBranches: 1 } }, currentPlan: { name: 'Starter', trialDays: 14, extraBranchMinor: 500_000, supportResponse: '2 working days' } });
      expect(view.plans.map((p: any) => p.priceYearlyMinor)).toEqual([6_800_000, 9_800_000, 15_000_000]);

      // Premium has no staff limit, so there is no extra staff to buy.
      await setPlan(lc.id, { planId: (await planByName('Premium')).id });
      expect((await lc.owner.post('/organization/plan/upgrade-request', { kind: 'EXTRA_STAFF', quantity: 1 })).body.error.code).toBe('EXTRA_NOT_OFFERED');
      await setPlan(lc.id, { planId: null });
      await billing({});
    });

    it('records payments: paid until, free months for a year upfront, cancelling, reminders, the summary and pausing for non-payment', async () => {
      const starterPlan = await planByName('Starter');
      await setPlan(lc.id, { planId: starterPlan.id });
      const overview = async () => (await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body;
      const pay = (body: Record<string, unknown>) =>
        superAdmin.post(`/platform/clinics/${lc.id}/payments`, { billingCycle: 'MONTHLY', paidMonths: 1, freeMonths: 0, amountMinor: 680_000, paidAt: new Date().toISOString(), method: 'BANK_TRANSFER', ...body });
      const before = (await overview()).clinic;
      expect(before.payment).toMatchObject({ kind: before.paidUntil ? expect.any(String) : 'UNPAID', currency: 'PKR' });
      expect(before.bill).toMatchObject({ monthlyFeeMinor: expect.any(Number), yearlyFeeMinor: expect.any(Number), chargeMinor: before.bill.monthlyFeeMinor });

      // Only the super admin records payments.
      expect((await lc.owner.post(`/platform/clinics/${lc.id}/payments`, {})).status).toBe(403);
      expect((await pay({ billingCycle: 'YEARLY', paidMonths: 6 })).status).toBe(400);
      expect((await pay({ paidAt: new Date(Date.now() + 5 * 86400_000).toISOString() })).body.error.code).toBe('DATE_IN_FUTURE');

      // Paying a year upfront during the free trial: the year (plus one free month) starts when the trial ends.
      const trialEnds = new Date(Date.now() + 10 * 86400_000).toISOString();
      await superAdmin.call('put', `/platform/clinics/${lc.id}/billing`, { billingCycle: 'MONTHLY', trialEndsAt: trialEnds, trialThenPlanId: null });
      const yearly = await pay({ billingCycle: 'YEARLY', paidMonths: 12, freeMonths: 1, amountMinor: 6_800_000, method: 'JAZZCASH', reference: 'JC-881' });
      expect(yearly.status).toBe(201);
      expect(yearly.body).toMatchObject({ receipt: expect.stringMatching(/^NC-\d{6}$/), clinicName: 'Limits Vets', planName: 'Starter', paidMonths: 12, freeMonths: 1, periodStart: trialEnds, voidedAt: null });
      const end = new Date(trialEnds);
      end.setUTCMonth(end.getUTCMonth() + 13);
      expect(yearly.body.periodEnd.slice(0, 10)).toBe(end.toISOString().slice(0, 10));
      let o = await overview();
      expect(o.clinic).toMatchObject({ trialEndsAt: null, billingCycle: 'YEARLY', paidUntil: yearly.body.periodEnd, payment: { kind: 'PAID' }, bill: { cycle: 'YEARLY', periodMonths: 12 } });
      expect(o.payments[0]).toMatchObject({ id: yearly.body.id, method: 'JAZZCASH', reference: 'JC-881' });
      expect(o.events.map((e: any) => e.action)).toContain('platform.payment_recorded');
      const owner = (await lc.owner.get('/organization/plan')).body.billing;
      expect(owner).toMatchObject({ paidUntil: yearly.body.periodEnd, payment: { kind: 'PAID' }, payments: [{ receipt: yearly.body.receipt, freeMonths: 1 }] });

      // A further payment carries on from the end of what is paid; cancelling it puts "paid until" back.
      const more = await pay({ billingCycle: 'YEARLY', paidMonths: 12, amountMinor: 6_800_000 });
      expect(more.body.periodStart).toBe(yearly.body.periodEnd);
      // A start date chosen by the super admin is used as given (within a year of today).
      expect((await pay({ periodStart: new Date(Date.now() - 500 * 86400_000).toISOString() })).body.error.code).toBe('PERIOD_START_OUT_OF_RANGE');
      expect((await superAdmin.post(`/platform/payments/${more.body.id}/cancel`, { reason: 'x' })).status).toBe(400);
      expect((await superAdmin.post(`/platform/payments/${more.body.id}/cancel`, { reason: 'Recorded twice' })).body).toMatchObject({ voidReason: 'Recorded twice', voidedAt: expect.any(String) });
      expect((await superAdmin.post(`/platform/payments/${more.body.id}/cancel`, { reason: 'Recorded twice' })).body.error.code).toBe('ALREADY_CANCELLED');
      expect((await overview()).clinic.paidUntil).toBe(yearly.body.periodEnd);
      const listed = (await superAdmin.get(`/platform/payments?clinicId=${lc.id}`)).body as any[];
      expect(listed.map((p) => [p.id, !!p.voidedAt])).toEqual(expect.arrayContaining([[yearly.body.id, false], [more.body.id, true]]));
      expect((await lc.owner.get('/organization/plan')).body.billing.payments).toHaveLength(1);

      // Nothing is due while paid up; the summary counts what was collected.
      expect((await superAdmin.post(`/platform/clinics/${lc.id}/payment-reminder`, {})).body.error.code).toBe('NOTHING_DUE');
      const sum = (await superAdmin.get('/platform/billing/summary')).body;
      expect(sum.months).toHaveLength(12);
      expect(sum.collectedThisMonthMinor).toBeGreaterThanOrEqual(6_800_000);
      expect(sum.months[11].totalMinor).toBe(sum.collectedThisMonthMinor);
      expect((await lc.owner.get('/platform/billing/summary')).status).toBe(403);

      // Paused for non-payment: staff see why, and paying lifts the pause.
      expect((await superAdmin.post(`/platform/clinics/${lc.id}/suspend`, { reason: 'UNPAID' })).body).toMatchObject({ status: 'SUSPENDED', pausedReason: 'UNPAID' });
      const blocked = await lc.owner.get('/organization/plan');
      expect([blocked.status, blocked.body.error.code]).toEqual([403, 'PAYMENT_OVERDUE']);
      const back = await pay({ billingCycle: 'YEARLY', paidMonths: 12, amountMinor: 6_800_000 });
      expect(back.status).toBe(201);
      expect((await overview()).clinic).toMatchObject({ status: 'ACTIVE', pausedReason: null });
      expect((await lc.owner.get('/organization/plan')).status).toBe(200);
      await superAdmin.call('put', `/platform/clinics/${lc.id}/billing`, { billingCycle: 'MONTHLY', trialEndsAt: null, trialThenPlanId: null });
      await setPlan(lc.id, { planId: null });
    });

    it('bills every staff account and branch the clinic really has above its plan', async () => {
      await setPlan(lc.id, { planId: null });
      await superAdmin.call('put', `/platform/clinics/${lc.id}/billing`, { billingCycle: 'MONTHLY', trialEndsAt: null, trialThenPlanId: null });
      // Without a plan there are no limits, so the clinic can have more staff than Starter includes.
      const usage = async () => (await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body.usage;
      while ((await usage()).staffCounted < 4) expect((await invite(lc.owner)).status).toBe(201);
      const { staffCounted, branches } = await usage();
      await setPlan(lc.id, { planId: (await planByName('Starter')).id });

      const over = staffCounted - 2;
      const expected = { extraStaff: over, extraStaffMinor: 50_000, extraBranches: Math.max(0, branches - 1), extrasMinor: over * 50_000 + Math.max(0, branches - 1) * 500_000 };
      expect(expected.extraStaff).toBeGreaterThanOrEqual(2);
      expect((await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body.clinic.bill).toMatchObject({ ...expected, totalMinor: 680_000 + expected.extrasMinor });
      expect(((await superAdmin.get('/platform/clinics')).body as any[]).find((c) => c.id === lc.id).bill).toMatchObject(expected);
      expect((await lc.owner.get('/organization/plan')).body.billing.bill).toMatchObject(expected);
      // Extra places given but not used yet are billed too.
      expect((await setPlan(lc.id, { planId: (await planByName('Starter')).id, staffLimitOverride: staffCounted + 2 })).body.bill).toBeDefined();
      expect((await superAdmin.get(`/platform/clinics/${lc.id}/overview`)).body.clinic.bill).toMatchObject({ extraStaff: over + 2 });
      await setPlan(lc.id, { planId: null });
    });

    it('ends free periods: then another plan, or paused until marked as paid', async () => {
      const svc = app.get(PlatformClinicsService);
      const billing = (body: Record<string, unknown>) => superAdmin.call('put', `/platform/clinics/${lc.id}/billing`, { billingCycle: 'MONTHLY', trialEndsAt: null, trialThenPlanId: null, ...body });
      const starterPlan = await planByName('Starter');
      await setPlan(lc.id, { planId: (await planByName('Professional')).id });
      const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
      const later = new Date(Date.now() + 4 * 86400_000);
      expect((await billing({ trialEndsAt: new Date(Date.now() - 60_000).toISOString() })).body.error.code).toBe('DATE_PASSED');

      // A free month of Professional, then back to Starter.
      const set = await billing({ trialEndsAt: soon, trialThenPlanId: starterPlan.id });
      expect(set.body).toMatchObject({ trialEndsAt: soon, trialThenPlanId: starterPlan.id, bill: { inTrial: true, totalMinor: 0 } });
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: 'Professional', trialEndsAt: soon });
      expect(await svc.endTrials()).toBe(0);
      expect(await svc.endTrials(later)).toBe(1);
      expect((await lc.owner.get('/auth/session')).body.entitlements).toMatchObject({ planName: 'Starter', trialEndsAt: null });

      // A trial with nothing after it pauses the clinic, which says why; reactivating means it is paying now.
      await billing({ trialEndsAt: soon });
      await svc.endTrials(later);
      expect((await superAdmin.get(`/platform/clinics/${lc.id}`)).body).toMatchObject({ status: 'SUSPENDED', pausedReason: 'TRIAL_ENDED' });
      expect((await lc.owner.get('/auth/session')).body.error.code).toBe('TRIAL_ENDED');
      expect((await superAdmin.post(`/platform/clinics/${lc.id}/reactivate`, {})).body).toMatchObject({ status: 'ACTIVE', pausedReason: null, trialEndsAt: null });
      expect((await lc.owner.get('/auth/session')).status).toBe(200);
      await setPlan(lc.id, { planId: null });
    });
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
