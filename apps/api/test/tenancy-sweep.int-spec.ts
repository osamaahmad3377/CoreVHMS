import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { booking, closeApp, futureDate, getApp, karachi, prisma, registerOrg, schedulingFixture, stockFixture, unique } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

/** Staff GET routes that take path parameters (portal and public routes have their own suites). */
async function parameterisedGetRoutes() {
  const app = await getApp();
  const out: string[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as any;
      if (!cls?.prototype) continue;
      if (Reflect.getMetadata('vcms:portal', cls)) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '').replace(/^\/|\/$/g, '');
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const h = cls.prototype[name];
        if (typeof h !== 'function' || Reflect.getMetadata(PATH_METADATA, h) === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, h) !== RequestMethod.GET) continue;
        if (Reflect.getMetadata('vcms:public', h) || Reflect.getMetadata('vcms:portal', h)) continue;
        const path = `/${[base, String(Reflect.getMetadata(PATH_METADATA, h)).replace(/^\/|\/$/g, '')].filter(Boolean).join('/')}`;
        if (path.includes(':')) out.push(path);
      }
    }
  }
  return out;
}

const ok = (res: { status: number; body: any }, what: string) => {
  if (res.status >= 300) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

describe('Multi-tenant isolation sweep', () => {
  afterAll(closeApp);

  it('no GET route returns another clinic’s record when given its id', async () => {
    // Clinic A with records across many modules.
    const a = await registerOrg(unique('Sweep Alpha'));
    const f = await schedulingFixture(a);
    ok(await a.owner.post('/appointments', booking(a, f, karachi(futureDate(3), '10:00'))), 'appointment');
    ok(await a.owner.post(`/patients/${f.patient.id}/alerts`, { type: 'ALLERGY', severity: 'CRITICAL', title: 'Sweep allergy', substance: 'sweepamox' }), 'alert');
    ok(await a.owner.post(`/patients/${f.patient.id}/weights`, { weightKg: 12.5 }), 'weight');
    ok(await a.owner.post(`/clients/${f.client.id}/notes`, { body: 'Sweep note' }), 'note');
    ok(await a.owner.upload('/attachments', { entityType: 'Patient', entityId: f.patient.id }, { buffer: PNG, name: 'sweep.png', type: 'image/png' }), 'attachment');
    const enc = ok(await f.vet.client.post('/encounters', { patientId: f.patient.id, chiefComplaint: 'Sweep check' }), 'encounter');
    ok(await f.vet.client.post(`/encounters/${enc.id}/vitals`, { temperatureC: 38.5, heartRate: 100 }), 'vitals');
    const stock = await stockFixture(a);
    ok(await f.vet.client.post('/prescriptions', { patientId: f.patient.id, items: [{ productId: stock.product.id, route: 'PO', doseValue: 1, doseUnit: 'tablet', frequencyCode: 'ONCE', quantity: 2, instructions: 'x' }], authorize: true }), 'prescription');
    const inv = ok(await a.owner.post('/invoices', { clientId: f.client.id, lines: [{ kind: 'CUSTOM', description: 'Sweep consult', quantity: 1, unitPriceMinor: 1000 }], issue: true }), 'invoice');
    ok(await a.owner.post('/payments', { clientId: f.client.id, method: 'CARD', amountMinor: 500, allocations: [{ invoiceId: inv.id, amountMinor: 500 }] }), 'payment');
    const ward = ok(await a.owner.post('/wards', { branchId: a.branchId, name: 'Sweep ward', type: 'GENERAL' }), 'ward');
    const cage = ok(await a.owner.post('/cages', { wardId: ward.id, name: 'S1' }), 'cage');
    ok(await f.vet.client.post('/admissions', { patientId: f.patient.id, wardId: ward.id, cageId: cage.id, reason: 'Sweep observation', responsibleClinicianId: f.vet.membershipId }), 'admission');
    ok(await a.owner.post('/farms', { clientId: f.client.id, name: unique('Sweep Farm') }), 'farm');

    // One sample id from every organisation-owned table that has rows for clinic A; every id of A is a leak marker.
    const tables = await prisma().$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.columns i ON i.table_schema = c.table_schema AND i.table_name = c.table_name AND i.column_name = 'id'
      WHERE c.table_schema = 'public' AND c.column_name = 'organizationId' AND c.table_name <> 'AuditEvent'`;
    const probes: { table: string; id: string }[] = [];
    const markers = new Set<string>([a.orgId]);
    for (const { table_name } of tables) {
      const rows = await prisma().$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM "${table_name}" WHERE "organizationId" = $1::uuid ORDER BY id`, a.orgId);
      rows.forEach((r) => markers.add(r.id));
      if (rows.length) probes.push({ table: table_name, id: rows[0].id });
    }
    expect(probes.length).toBeGreaterThan(30);

    // Clinic B (its owner has every permission) tries each of A's ids on every parameterised GET route.
    const b = await registerOrg(unique('Sweep Beta'));
    const routes = await parameterisedGetRoutes();
    expect(routes.length).toBeGreaterThan(45);
    const leaks: string[] = [];
    for (const route of routes) {
      for (const p of probes) {
        const path = route.replace(/:[A-Za-z]+/g, p.id);
        const res = await b.owner.get(path);
        if (res.status >= 300) continue;
        const text = res.text ?? '';
        const found = [...markers].find((m) => text.includes(m));
        if (found) leaks.push(`${route} with ${p.table} id → ${res.status}, contains clinic A id ${found}`);
      }
    }
    expect(leaks).toEqual([]);

    // Sanity check that the probe works: clinic A itself can read its own records this way.
    expect((await a.owner.get(`/clients/${f.client.id}`)).text).toContain(f.client.id);
  }, 300_000);
});
