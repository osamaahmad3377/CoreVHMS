import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/common/mail/mail.service';
import { PrismaService } from '../src/common/prisma/prisma.service';

export const PASSWORD = 'Testing12345A';

let app: INestApplication | null = null;

export async function getApp(): Promise<INestApplication> {
  if (app) return app;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}

export async function closeApp() {
  if (app) await app.close();
  app = null;
}

export const prisma = () => app!.get(PrismaService).raw;
export const mail = () => app!.get(MailService);

let seq = 0;
export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;

/** HTTP client that keeps the session cookie and sends the CSRF header automatically. */
export class TestClient {
  cookies: string[] = [];
  csrf = '';
  branchId?: string;
  session: any;

  constructor(
    private readonly app: INestApplication,
    private readonly csrfCookie = 'vcms_csrf',
  ) {}

  private store(res: request.Response) {
    const set = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (!set) return;
    for (const c of set) {
      const [pair] = c.split(';');
      const [name, value] = pair.split('=');
      this.cookies = this.cookies.filter((x) => !x.startsWith(name + '='));
      if (value) this.cookies.push(pair);
      if (name === this.csrfCookie) this.csrf = value;
    }
  }

  private req(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) {
    const r = (request(this.app.getHttpServer()) as any)[method](`/api/v1${path}`).set('Cookie', this.cookies.join('; '));
    if (this.csrf && method !== 'get') r.set('x-csrf-token', this.csrf);
    if (this.branchId) r.set('x-branch-id', this.branchId);
    return r as request.Test;
  }

  async call(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown) {
    const r = this.req(method, path);
    const res = body !== undefined ? await r.send(body as object) : await r;
    this.store(res);
    return res;
  }
  get = (p: string) => this.call('get', p);
  post = (p: string, b?: unknown) => this.call('post', p, b ?? {});
  patch = (p: string, b?: unknown) => this.call('patch', p, b ?? {});
  del = (p: string) => this.call('delete', p);

  upload(path: string, fields: Record<string, string>, file: { buffer: Buffer; name: string; type: string }) {
    let r = this.req('post', path);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', file.buffer, { filename: file.name, contentType: file.type });
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.post('/auth/login', { email, password });
    if (res.status === 200 && res.body.session) this.session = res.body.session;
    return res;
  }
}

export interface OrgFixture {
  owner: TestClient;
  orgId: string;
  branchId: string;
  email: string;
}

export async function registerOrg(name = unique('Org'), country: 'PK' | 'AU' = 'PK'): Promise<OrgFixture> {
  const a = await getApp();
  const owner = new TestClient(a);
  const email = `${unique('owner')}@test.local`.toLowerCase();
  const res = await owner.post('/auth/register', {
    organizationName: name,
    country,
    branchName: 'Main Clinic',
    ownerName: 'Olivia Owner',
    email,
    password: PASSWORD,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  owner.session = res.body.session;
  return { owner, orgId: res.body.session.organization.id, branchId: res.body.session.branch.id, email };
}

/** Invites a staff member with the given system role and returns a logged-in client for them. */
export async function staff(org: OrgFixture, roleKey: string, extra: { isClinician?: boolean } = {}) {
  const roles = (await org.owner.get('/roles')).body as any[];
  const role = roles.find((r) => r.key === roleKey);
  if (!role) throw new Error(`role ${roleKey} not found`);
  const email = `${unique(roleKey)}@test.local`.toLowerCase();
  const inv = await org.owner.post('/staff/invite', {
    email,
    name: `Test ${roleKey}`,
    roleIds: [role.id],
    branchIds: [org.branchId],
    isClinician: extra.isClinician ?? false,
  });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const msg = mail().outbox.filter((m) => m.to === email).pop()!;
  const token = decodeURIComponent(/token=([^\s"&]+)/.exec(msg.text)![1]);
  const client = new TestClient(await getApp());
  const acc = await client.post('/auth/invitations/accept', { token, name: `Test ${roleKey}`, password: PASSWORD });
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status} ${JSON.stringify(acc.body)}`);
  client.session = acc.body.session;
  return { client, email, membershipId: inv.body.id as string };
}

export async function speciesId(c: TestClient, name = 'Dog') {
  const list = (await c.get('/species')).body as any[];
  return list.find((s) => s.name === name).id as string;
}

export async function makeClient(c: TestClient, overrides: Record<string, unknown> = {}) {
  const res = await c.post('/clients', {
    type: 'INDIVIDUAL',
    firstName: 'Ayesha',
    lastName: unique('Khan'),
    mobilePhone: `+92 300 ${String(Math.floor(Math.random() * 9e6) + 1e6)}`,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`client create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function makePatient(c: TestClient, ownerId: string, overrides: Record<string, unknown> = {}) {
  const res = await c.post('/patients', {
    ownerId,
    name: 'Bruno',
    speciesId: await speciesId(c),
    sex: 'MALE',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`patient create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// ── Scheduling fixtures ──
import { zonedToUtc } from '../src/common/time/tz';

/** A branch-local (Asia/Karachi) date `days` ahead, as YYYY-MM-DD. */
export function futureDate(days = 7) {
  return new Date(Date.now() + days * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
}
export const karachi = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(date, h * 60 + m, 'Asia/Karachi').toISOString();
};

export interface SchedulingFixture {
  typeId: string;
  vet: Awaited<ReturnType<typeof staff>>;
  client: any;
  patient: any;
}

/** Appointment type (20 min), a clinician rostered 09:00–17:00 every day, and a client with a patient. */
export async function schedulingFixture(org: OrgFixture): Promise<SchedulingFixture> {
  const type = await org.owner.post('/appointment-types', { name: unique('Consult'), durationMinutes: 20, category: 'CONSULTATION' });
  if (type.status !== 201) throw new Error(`type: ${JSON.stringify(type.body)}`);
  const vet = await staff(org, 'veterinarian', { isClinician: true });
  const hours = await org.owner.call('put', `/schedules/working-hours/${vet.membershipId}`, {
    branchId: org.branchId,
    slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 17 * 60 })),
  });
  if (hours.status !== 200) throw new Error(`hours: ${JSON.stringify(hours.body)}`);
  const client = await makeClient(org.owner);
  const patient = await makePatient(org.owner, client.id);
  return { typeId: type.body.id, vet, client, patient };
}

export function booking(org: OrgFixture, f: SchedulingFixture, startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    branchId: org.branchId,
    clientId: f.client.id,
    patientId: f.patient.id,
    appointmentTypeId: f.typeId,
    clinicianId: f.vet.membershipId,
    startsAt,
    ...extra,
  };
}

// ── Inventory & billing fixtures (amounts are arbitrary test values) ──
export async function stockFixture(org: OrgFixture) {
  const loc = await org.owner.post('/stock-locations', { branchId: org.branchId, name: unique('Pharmacy'), type: 'PHARMACY', isDefault: true });
  if (loc.status !== 201) throw new Error(JSON.stringify(loc.body));
  const supplier = await org.owner.post('/suppliers', { name: unique('Supplier') });
  const product = await org.owner.post('/products', { name: unique('Testcillin 100 mg tablets'), strengthValue: 100, strengthUnit: 'mg', dispensingUnit: 'tablet', minDispenseIncrement: 1, sellPriceMinor: 500 });
  return { locationId: loc.body.id as string, supplierId: supplier.body.id as string, product: product.body };
}

export function inDays(days: number) {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

/** A client-portal browser (portal cookies and CSRF cookie). */
export async function portalClient() {
  return new TestClient(await getApp(), 'vcms_pcsrf');
}

/** Extracts the token from the latest portal email sent to an address. */
export function portalTokenFor(email: string, kind: 'accept' | 'reset') {
  const msg = [...mail().outbox].reverse().find((m) => m.to === email && m.text.includes(`/portal/${kind}?token=`));
  return msg?.text.match(new RegExp(`/portal/${kind}\\?token=([\\w-]+)`))?.[1];
}
