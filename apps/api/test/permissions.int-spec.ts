import { TestClient, closeApp, getApp, mail, registerOrg, staff } from './helpers';

/** [method, path, body] for sensitive operations, and which system roles may perform them. */
const MATRIX: { route: [string, string, unknown?]; allowed: string[]; denied: string[] }[] = [
  { route: ['get', '/audit-events'], allowed: ['owner', 'practice_manager'], denied: ['receptionist', 'veterinarian', 'nurse'] },
  { route: ['get', '/roles/permissions'], allowed: ['owner', 'practice_manager'], denied: ['nurse', 'lab_technician'] },
  { route: ['post', '/roles', { name: 'X', permissions: [] }], allowed: ['owner'], denied: ['practice_manager', 'veterinarian'] },
  { route: ['patch', '/organization', { name: 'Renamed' }], allowed: ['owner'], denied: ['practice_manager', 'receptionist'] },
  { route: ['get', '/clients'], allowed: ['receptionist', 'veterinarian'], denied: ['inventory_officer'] },
  { route: ['get', '/clients/export.csv'], allowed: ['owner', 'practice_manager'], denied: ['receptionist', 'veterinarian'] },
  { route: ['post', '/clients/merge', { survivorId: '00000000-0000-4000-8000-000000000000', mergedId: '00000000-0000-4000-8000-000000000001', reason: 'x' }], allowed: [], denied: ['receptionist', 'veterinarian'] },
  { route: ['get', '/staff'], allowed: ['practice_manager'], denied: ['receptionist', 'nurse'] },
];

describe('Server-side permission enforcement', () => {
  afterAll(closeApp);

  it('enforces the role/permission matrix on the server', async () => {
    const org = await registerOrg();
    const keys = new Set(MATRIX.flatMap((m) => [...m.allowed, ...m.denied]).filter((k) => k !== 'owner'));
    const clients: Record<string, any> = { owner: org.owner };
    for (const k of keys) clients[k] = (await staff(org, k)).client;

    for (const m of MATRIX) {
      const [method, path, body] = m.route;
      for (const role of m.denied) {
        const res = await clients[role].call(method, path, body);
        expect({ role, path, status: res.status }).toEqual({ role, path, status: 403 });
      }
      for (const role of m.allowed) {
        const res = await clients[role].call(method, path, body);
        expect({ role, path, ok: res.status !== 403 && res.status !== 401 }).toEqual({ role, path, ok: true });
      }
    }
  });

  it('prevents privilege escalation through role assignment and role editing', async () => {
    const org = await registerOrg();
    const pm = await staff(org, 'practice_manager');
    const roles = (await org.owner.get('/roles')).body as any[];
    const ownerRole = roles.find((r) => r.key === 'owner');
    const vetRole = roles.find((r) => r.key === 'veterinarian');
    // practice manager cannot grant the owner role (or vet role with clinical.sign they lack)
    const res = await pm.client.post('/staff/invite', {
      email: 'escalate@test.local', name: 'Esc', roleIds: [ownerRole.id], branchIds: [org.branchId],
    });
    expect(res.status).toBe(403);
    const res2 = await pm.client.post('/staff/invite', {
      email: 'escalate2@test.local', name: 'Esc', roleIds: [vetRole.id], branchIds: [org.branchId],
    });
    expect(res2.status).toBe(403);
    // practice manager cannot change their own roles
    const res3 = await pm.client.patch(`/staff/${pm.membershipId}`, { roleIds: [ownerRole.id] });
    expect([403, 422]).toContain(res3.status);
    // owner role cannot be edited
    expect((await org.owner.patch(`/roles/${ownerRole.id}`, { permissions: [] })).status).toBe(422);
  });

  it('keeps at least one active owner', async () => {
    const org = await registerOrg();
    const me = (await org.owner.get('/staff')).body[0];
    const res = await org.owner.patch(`/staff/${me.id}`, { status: 'SUSPENDED' });
    expect(res.status).toBe(422);
  });

  it('custom roles grant exactly their permissions', async () => {
    const org = await registerOrg();
    const role = (await org.owner.post('/roles', { name: 'Front desk lite', permissions: ['clients.read', 'patients.read'] })).body;
    const email = `lite-${Date.now()}@test.local`;
    await org.owner.post('/staff/invite', { email, name: 'Lite', roleIds: [role.id], branchIds: [org.branchId] });
    const msg = mail().outbox.filter((m: any) => m.to === email).pop();
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(msg!.text)![1]);
    const c = new TestClient(await getApp());
    await c.post('/auth/invitations/accept', { token, name: 'Lite', password: 'Testing12345A' });
    expect((await c.get('/clients')).status).toBe(200);
    expect((await c.post('/clients', { lastName: 'X', mobilePhone: '0300 1234567' })).status).toBe(403);
  });
});
