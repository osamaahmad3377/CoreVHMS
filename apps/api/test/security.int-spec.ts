import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { productionProblems, type Env } from '../src/config/env';
import { closeApp, getApp, makeClient, makePatient, prisma, registerOrg } from './helpers';

/** Every GET route reachable over HTTP, with path parameters filled in. */
async function allGetRoutes() {
  const app = await getApp();
  const out: { path: string; isPublic: boolean; portal: boolean }[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as any;
      if (!cls?.prototype) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '').replace(/^\/|\/$/g, '');
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const h = cls.prototype[name];
        if (typeof h !== 'function' || Reflect.getMetadata(PATH_METADATA, h) === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, h) !== RequestMethod.GET) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, h)).replace(/^\/|\/$/g, '');
        const path = `/${[base, sub].filter(Boolean).join('/')}`.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
        out.push({ path, isPublic: !!(Reflect.getMetadata('vcms:public', h) ?? Reflect.getMetadata('vcms:public', cls)), portal: !!(Reflect.getMetadata('vcms:portal', h) ?? Reflect.getMetadata('vcms:portal', cls)) });
      }
    }
  }
  return out;
}

describe('Security controls', () => {
  afterAll(closeApp);

  it('refuses every non-public GET route without a session', async () => {
    const app = await getApp();
    const routes = (await allGetRoutes()).filter((r) => !r.isPublic && !r.portal);
    expect(routes.length).toBeGreaterThan(120);
    const leaks: string[] = [];
    for (const r of routes) {
      const res = await request(app.getHttpServer()).get(`/api/v1${r.path}`);
      if (res.status !== 401) leaks.push(`${r.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('sets hardened session cookies and security headers', async () => {
    const app = await getApp();
    const org = await registerOrg();
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: org.email, password: 'Testing12345A' });
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/vcms_sid=[^;]+;.*HttpOnly/i);
    expect(cookies).toMatch(/vcms_sid=[^;]+;.*SameSite=(Lax|Strict)/i);
    expect(cookies).not.toMatch(/vcms_csrf=[^;]+;.*HttpOnly/i); // the CSRF token must be readable by the page
    const h = (await request(app.getHttpServer()).get('/api/v1/health')).headers;
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(h['strict-transport-security']).toBeTruthy();
  });

  it('rejects cross-origin state-changing requests even with a valid session and token', async () => {
    const org = await registerOrg();
    const app = await getApp();
    const res = await request(app.getHttpServer())
      .post('/api/v1/clients')
      .set('Cookie', org.owner.cookies.join('; '))
      .set('x-csrf-token', org.owner.csrf)
      .set('Origin', 'https://evil.example')
      .send({ type: 'INDIVIDUAL', firstName: 'X', lastName: 'Y', mobilePhone: '+92 300 1234567' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Cross-origin/);
  });

  it('treats injection-style input as data', async () => {
    const org = await registerOrg();
    const name = `Robert'); DROP TABLE "Client";-- <script>alert(1)</script>`;
    const c = await makeClient(org.owner, { firstName: name });
    await makePatient(org.owner, c.id);
    const search = await org.owner.get(`/clients?q=${encodeURIComponent("' OR 1=1 --")}`);
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(0);
    const got = await org.owner.get(`/clients/${c.id}`);
    expect(got.body.firstName).toBe(name); // stored verbatim; React escapes it when rendered
    expect((await org.owner.get('/clients')).body.meta.total).toBe(1);
    // Malformed ids and oversized pages are rejected by validation, not passed to the database.
    expect((await org.owner.get('/clients/not-a-uuid')).status).toBe(400);
    expect((await org.owner.get('/clients?pageSize=100000')).status).toBe(400);
  });

  it('reports readiness of database, migrations and storage', async () => {
    const app = await getApp();
    const r = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(r.status).toBe(200);
    expect(r.body.checks).toEqual({ database: 'ok', migrations: 'ok', storage: 'ok' });
  });

  it('refuses to start in production with placeholder secrets or insecure cookies', () => {
    const base = { NODE_ENV: 'production', SESSION_SECRET: 'f3a9c1d07b2e4f68a5c9e1b3d7f02468ace13579bdf02468', ENCRYPTION_KEY: '9f'.repeat(32), DATABASE_URL: 'postgresql://vcms:Str0ng-Pa55@db:5432/vcms', COOKIE_SECURE: true } as unknown as Env;
    expect(productionProblems(base)).toEqual([]);
    expect(productionProblems({ ...base, SESSION_SECRET: 'change-me-change-me-change-me-change-me' })).toHaveLength(1);
    expect(productionProblems({ ...base, DATABASE_URL: 'postgresql://vcms:vcms_dev_password@localhost:5433/vcms' })).toHaveLength(1);
    expect(productionProblems({ ...base, COOKIE_SECURE: false })).toHaveLength(1);
    expect(productionProblems({ ...base, ENCRYPTION_KEY: '0'.repeat(64) })).toHaveLength(1);
    expect(productionProblems({ ...base, NODE_ENV: 'development', COOKIE_SECURE: false } as Env)).toEqual([]);
  });

  it('exports the audit log as CSV for the own clinic only, neutralising spreadsheet formulas', async () => {
    const org = await registerOrg();
    await makeClient(org.owner, { firstName: '=HYPERLINK("http://evil")', lastName: 'Formula' });
    const other = await registerOrg();
    await makeClient(other.owner, { firstName: 'OtherClinicClient' });
    await prisma().auditEvent.create({ data: { organizationId: org.orgId, actorName: 'Test', action: 'client.note', entityType: 'Client', entityId: org.orgId, summary: '=SUM(1,2)' } });
    const res = await org.owner.get('/audit-events/export.csv?action=client.');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\r\n')[0]).toBe('createdAt,actorName,actorUserId,action,entityType,entityId,summary,changes,ip,userAgent,requestId,branchId,id');
    expect(res.text).toContain('client.created');
    expect(res.text).not.toContain('OtherClinicClient');
    expect(res.text).toContain(`"'=SUM(1,2)"`);
    expect(res.text).not.toMatch(/(^|,)"=/m);
    // Statements carry staff-entered reasons (credit notes, refunds, voids): also neutralised.
    const c = await makeClient(org.owner);
    const inv = (await org.owner.post('/invoices', { clientId: c.id, lines: [{ kind: 'CUSTOM', description: 'Consult', quantity: 1, unitPriceMinor: 100 }], issue: true })).body;
    expect((await org.owner.post(`/invoices/${inv.id}/credit-notes`, { amountMinor: 50, reason: '=cmd|calc' })).status).toBe(201);
    const st = await org.owner.get(`/clients/${c.id}/statement.csv`);
    expect(st.status).toBe(200);
    expect(st.text).toContain("'=cmd|calc");
    const rec = await (await import('./helpers')).staff(org, 'receptionist');
    expect((await rec.client.get('/audit-events/export.csv')).status).toBe(403);
    expect((await org.owner.get('/audit-events?action=audit.exported')).body.data).toHaveLength(1);
  });

  it('audits every kind of data export, and the combined Exports filter finds them all', async () => {
    const org = await registerOrg();
    const c = await makeClient(org.owner);
    expect((await org.owner.get('/clients/export.csv')).status).toBe(200);
    expect((await org.owner.get(`/clients/${c.id}/statement.csv`)).status).toBe(200);
    expect((await org.owner.get(`/clients/${c.id}/data-export`)).status).toBe(200);
    expect((await org.owner.get('/reports/financial-summary?from=2026-01-01&to=2026-12-31&format=csv')).status).toBe(200);
    expect((await org.owner.get('/reports/financial-summary?from=2026-01-01&to=2026-12-31')).status).toBe(200); // on screen: not an export
    expect((await org.owner.get('/audit-events/export.csv')).status).toBe(200);
    const exportsFilter = 'client.exported,client.data_exported,client.statement_exported,report.exported,audit.exported';
    const res = await org.owner.get(`/audit-events?pageSize=50&action=${encodeURIComponent(exportsFilter)}`);
    expect(res.status).toBe(200);
    const events = res.body.data as { action: string; entityId: string | null; summary: string }[];
    expect(events.map((e) => e.action).sort()).toEqual(['audit.exported', 'client.data_exported', 'client.exported', 'client.statement_exported', 'report.exported']);
    expect(events.find((e) => e.action === 'client.statement_exported')!.entityId).toBe(c.id);
    expect(events.find((e) => e.action === 'report.exported')!.summary).toMatch(/^financial-summary 2026-01-01 – 2026-12-31/);
    // A single prefix still works as before.
    expect((await org.owner.get('/audit-events?action=report.')).body.data).toHaveLength(1);
  });
});
