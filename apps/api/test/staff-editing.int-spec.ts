import { closeApp, prisma, registerOrg, staff } from './helpers';

describe('Editing staff roles and details', () => {
  afterAll(closeApp);

  it('lets the owner edit anyone’s name, email, job and roles — and their own, keeping Owner', async () => {
    const org = await registerOrg();
    const roles = (await org.owner.get('/roles')).body as any[];
    const role = (key: string) => roles.find((r) => r.key === key).id;
    const me = (await org.owner.get('/staff')).body.find((m: any) => m.user.email === org.email);
    const nurse = await staff(org, 'nurse');

    // Someone else: name, email, job and roles together.
    const email = `renamed-${Date.now()}@test.local`;
    const n = await org.owner.patch(`/staff/${nurse.membershipId}`, { name: 'Nadia Nurse', email: email.toUpperCase(), jobTitle: 'Head nurse', roleIds: [role('nurse'), role('receptionist')], branchIds: [org.branchId] });
    expect(n.status).toBe(200);
    expect(n.body).toMatchObject({ jobTitle: 'Head nurse', user: { name: 'Nadia Nurse', email } });
    expect(n.body.roles.map((r: any) => r.key).sort()).toEqual(['nurse', 'receptionist']);
    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { organizationId: org.orgId, action: 'membership.updated', entityId: nurse.membershipId } });
    expect(audit.changes).toMatchObject({ name: { to: 'Nadia Nurse' }, email: { to: email } });
    // An email another account uses is refused.
    expect((await org.owner.patch(`/staff/${nurse.membershipId}`, { email: org.email })).status).toBe(409);

    // Your own details, saved with your unchanged roles (as the edit form sends them).
    const own = await org.owner.patch(`/staff/${me.id}`, { name: 'Olivia Owner-Khan', jobTitle: 'Clinical director', roleIds: [role('owner')], branchIds: [org.branchId] });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ jobTitle: 'Clinical director', user: { name: 'Olivia Owner-Khan' } });
    // An owner can add a role to themselves, but not drop Owner or suspend themselves.
    const vet = await org.owner.patch(`/staff/${me.id}`, { roleIds: [role('owner'), role('veterinarian')] });
    expect(vet.body.roles.map((r: any) => r.key).sort()).toEqual(['owner', 'veterinarian']);
    expect((await org.owner.patch(`/staff/${me.id}`, { roleIds: [role('veterinarian')] })).body.error.code).toBe('SELF_CHANGE');
    expect((await org.owner.patch(`/staff/${me.id}`, { status: 'SUSPENDED' })).body.error.code).toBe('SELF_CHANGE');

    // Others can't change their own roles; a manager can't edit the owner.
    const pm = await staff(org, 'practice_manager');
    expect((await pm.client.patch(`/staff/${pm.membershipId}`, { jobTitle: 'Manager', roleIds: [role('practice_manager')] })).status).toBe(200);
    expect((await pm.client.patch(`/staff/${pm.membershipId}`, { roleIds: [role('practice_manager'), role('receptionist')] })).body.error.code).toBe('SELF_CHANGE');
    expect((await pm.client.patch(`/staff/${me.id}`, { name: 'Hijack' })).status).toBe(403);
  });

  it('won’t rename an account that is also used at another organization', async () => {
    const a = await registerOrg();
    const b = await registerOrg();
    const shared = await staff(a, 'nurse');
    const user = await prisma().membership.findUniqueOrThrow({ where: { id: shared.membershipId } });
    const nurseRole = await prisma().role.findFirstOrThrow({ where: { organizationId: b.orgId, key: 'nurse' } });
    await prisma().membership.create({ data: { organizationId: b.orgId, userId: user.userId, status: 'ACTIVE', roles: { create: [{ roleId: nurseRole.id }] } } });
    expect((await a.owner.patch(`/staff/${shared.membershipId}`, { name: 'Renamed' })).body.error.code).toBe('SHARED_ACCOUNT');
    // Their job at this clinic can still be edited.
    expect((await a.owner.patch(`/staff/${shared.membershipId}`, { jobTitle: 'Locum nurse' })).status).toBe(200);
  });
});
