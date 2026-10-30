import { booking, closeApp, karachi, makeClient, prisma, registerOrg, schedulingFixture, staff } from './helpers';

const step = (body: any, key: string) => body.steps.find((s: any) => s.key === key);

describe('Setup checklist', () => {
  afterAll(closeApp);

  it('derives progress from real configuration and is limited to administrators', async () => {
    const org = await registerOrg();
    const before = (await org.owner.get('/setup/status')).body;
    expect(before.total).toBe(11);
    expect(before.steps.map((s: any) => s.key)).toEqual(['profile', 'modules', 'prices', 'tax', 'staff', 'rosters', 'products', 'stock', 'receipt', 'cash', 'first-client']);
    expect(before.hidden).toBe(false);
    expect(step(before, 'first-client').done).toBe(false);
    // Starter services exist but have no price yet.
    expect(step(before, 'prices').done).toBe(false);
    expect(step(before, 'tax').done).toBe(false);
    await org.owner.post('/tax-rates', { name: 'Zero', rateBasisPoints: 0 });
    expect(step((await org.owner.get('/setup/status')).body, 'tax').done).toBe(true);

    const reception = await staff(org, 'receptionist');
    expect((await reception.client.get('/setup/status')).status).toBe(403);
    expect((await reception.client.post('/setup/steps/receipt/skip')).status).toBe(403);
    expect((await reception.client.post('/setup/hide')).status).toBe(403);
  });

  it('creates a starter cash drawer and price list on registration, with linked appointment types', async () => {
    const org = await registerOrg();
    const db = prisma();
    const registers = await db.cashRegister.findMany({ where: { organizationId: org.orgId } });
    expect(registers).toHaveLength(1);
    expect(registers[0].branchId).toBe(org.branchId);
    const services = await db.service.findMany({ where: { organizationId: org.orgId }, orderBy: { code: 'asc' } });
    expect(services.map((s) => s.name).sort()).toEqual(['Consultation', 'Deworming', 'Follow-up', 'Vaccination']);
    expect(services.every((s) => s.priceMinor === 0)).toBe(true);
    const types = await db.appointmentType.findMany({ where: { organizationId: org.orgId } });
    expect(types).toHaveLength(4);
    expect(types.every((t) => services.some((s) => s.id === t.serviceId && s.name === t.name))).toBe(true);
    // No stock location yet: an empty store would switch stock checks on before any stock is entered.
    expect(await db.stockLocation.count({ where: { organizationId: org.orgId } })).toBe(0);

    // Pricing every starter service ticks "Check your price list".
    for (const s of services) expect((await org.owner.patch(`/services/${s.id}`, { code: s.code, name: s.name, category: s.category, priceMinor: 150000 })).status).toBe(200);
    expect(step((await org.owner.get('/setup/status')).body, 'prices').done).toBe(true);

    // Starting "Enter the stock you have now" creates "Main store" once.
    const first = await org.owner.post('/setup/store-room');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true, location: { name: 'Main store', branchId: org.branchId } });
    expect((await org.owner.post('/setup/store-room')).body.created).toBe(false);
    expect(await db.auditEvent.count({ where: { organizationId: org.orgId, action: 'stock_location.created' } })).toBe(1);
  });

  it('remembers skipped steps and hiding for the whole clinic, with an audit trail', async () => {
    const org = await registerOrg();
    expect((await org.owner.post('/setup/steps/nonsense/skip')).status).toBe(404);
    const skipped = await org.owner.post('/setup/steps/receipt/skip');
    expect(skipped.status).toBe(200);
    expect(step(skipped.body, 'receipt').skipped).toBe(true);
    expect((await org.owner.post('/setup/hide')).body.hidden).toBe(true);
    // Stored on the organization, not the device: a second administrator sees the same state.
    const manager = await staff(org, 'practice_manager');
    const theirs = (await manager.client.get('/setup/status')).body;
    expect(theirs.hidden).toBe(true);
    expect(step(theirs, 'receipt').skipped).toBe(true);
    const shown = (await manager.client.post('/setup/show')).body;
    expect(shown.hidden).toBe(false);
    expect(step(shown, 'receipt').skipped).toBe(false);
    const actions = (await prisma().auditEvent.findMany({ where: { organizationId: org.orgId, action: { startsWith: 'setup.' } } })).map((a) => a.action).sort();
    expect(actions).toEqual(['setup.hidden', 'setup.shown', 'setup.step_skipped']);
  });

  it('ticks "Add your first client and book an appointment" only when both exist', async () => {
    const org = await registerOrg();
    await makeClient(org.owner);
    expect(step((await org.owner.get('/setup/status')).body, 'first-client').done).toBe(false);
    const f = await schedulingFixture(org);
    const day = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString().slice(0, 10);
    expect((await org.owner.post('/appointments', booking(org, f, karachi(day, '10:00')))).status).toBe(201);
    expect(step((await org.owner.get('/setup/status')).body, 'first-client').done).toBe(true);
  });
});

describe('Services you offer (optional modules)', () => {
  afterAll(closeApp);

  it('switches modules on and off, exposes them in the session and hides their dashboard panels', async () => {
    const org = await registerOrg();
    expect(org.owner.session.organization.enabledModules).toEqual(['hospital', 'surgery', 'lab', 'livestock', 'boarding', 'insurance', 'homeVisits', 'wellness', 'dental']);
    expect((await org.owner.get('/setup/modules')).body).toMatchObject({ enabled: ['hospital', 'surgery', 'lab', 'livestock', 'boarding', 'insurance', 'homeVisits', 'wellness', 'dental'], chosenAt: null });
    expect((await org.owner.get('/dashboard')).body.widgets).toHaveProperty('hospital');

    expect((await org.owner.call('put', '/setup/modules', { enabled: ['lab', 'nonsense'] })).status).toBe(400);
    const saved = await org.owner.call('put', '/setup/modules', { enabled: ['lab', 'boarding'] });
    expect(saved.status).toBe(200);
    expect(saved.body.enabled).toEqual(['lab', 'boarding']);
    expect(saved.body.chosenAt).toBeTruthy();

    const session = (await org.owner.get('/auth/session')).body;
    expect(session.organization.enabledModules).toEqual(['lab', 'boarding']);
    const widgets = (await org.owner.get('/dashboard')).body.widgets;
    expect(widgets).not.toHaveProperty('hospital');
    expect(widgets).not.toHaveProperty('surgery');
    expect(widgets).not.toHaveProperty('livestock');
    expect(widgets).not.toHaveProperty('insurance');
    expect(widgets).toHaveProperty('lab');
    expect(widgets).toHaveProperty('boarding');
    expect(step((await org.owner.get('/setup/status')).body, 'modules').done).toBe(true);

    // Hiding never blocks the data: the hospital API still answers for the owner.
    expect((await org.owner.get('/admissions')).status).not.toBe(403);

    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { organizationId: org.orgId, action: 'organization.modules_updated' } });
    expect(audit.summary).toContain('Turned off: hospital, surgery, livestock, insurance');

    const reception = await staff(org, 'receptionist');
    expect((await reception.client.call('put', '/setup/modules', { enabled: [] })).status).toBe(403);
    expect((await reception.client.get('/setup/modules')).status).toBe(403);
    // Everyone gets the clinic's list in their session, so menus hide for all staff.
    expect(reception.client.session.organization.enabledModules).toEqual(['lab', 'boarding']);
  });
});

describe('Dashboard widgets for the everyday flow', () => {
  afterAll(closeApp);

  it('gives the front desk who is waiting and who is arriving next, and owners this month’s takings', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const reception = await staff(org, 'receptionist');
    reception.client.branchId = org.branchId;
    const now = new Date();
    const at = (minutes: number) => new Date(Math.ceil((now.getTime() + minutes * 60_000) / (5 * 60_000)) * 5 * 60_000).toISOString();
    // Only bookings that stay within today (branch-local) count; skip near midnight to keep the test stable.
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Karachi' }).format(now));
    const roster = localHour >= 9 && localHour < 15;
    if (roster) {
      const a = await org.owner.post('/appointments', booking(org, f, at(30)));
      const b = await org.owner.post('/appointments', booking(org, f, at(60)));
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect((await reception.client.post(`/appointments/${a.body.id}/status`, { action: 'check-in' })).status).toBe(200);
      const fd = (await reception.client.get('/dashboard')).body.widgets.frontDesk;
      expect(fd.waitingCount).toBe(1);
      expect(fd.waiting[0].id).toBe(a.body.id);
      expect(fd.arriving.map((x: any) => x.id)).toEqual([b.body.id]);
    } else {
      const fd = (await reception.client.get('/dashboard')).body.widgets.frontDesk;
      expect(fd).toMatchObject({ waitingCount: 0, waiting: [], arriving: [] });
    }
    // Reception has no cash.manage: no cash-drawer widget; owners get it and the month figure.
    const recWidgets = (await reception.client.get('/dashboard')).body.widgets;
    expect(recWidgets).not.toHaveProperty('cashDrawers');
    const ownerWidgets = (await org.owner.get('/dashboard')).body.widgets;
    expect(ownerWidgets.finance).toHaveProperty('receivedMonthMinor', 0);
    expect(ownerWidgets.cashDrawers).toEqual({ notClosed: [] });
  });

  it('lists cash drawers left open from an earlier day', async () => {
    const org = await registerOrg();
    const register = await prisma().cashRegister.findFirstOrThrow({ where: { organizationId: org.orgId } });
    const opened = await org.owner.post('/cash/sessions', { registerId: register.id, openingFloatMinor: 0 });
    expect(opened.status).toBe(201);
    expect((await org.owner.get('/dashboard')).body.widgets.cashDrawers.notClosed).toEqual([]);
    await prisma().cashSession.update({ where: { id: opened.body.id }, data: { openedAt: new Date(Date.now() - 2 * 86400_000) } });
    const notClosed = (await org.owner.get('/dashboard')).body.widgets.cashDrawers.notClosed;
    expect(notClosed).toHaveLength(1);
    expect(notClosed[0]).toMatchObject({ sessionId: opened.body.id, register: register.name });
  });
});
