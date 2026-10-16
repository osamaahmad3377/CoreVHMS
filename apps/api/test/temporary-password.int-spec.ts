import { closeApp, getApp, mail, PASSWORD, prisma, registerOrg, staff, TestClient, unique } from './helpers';

const TEMP = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;

async function roleId(org: Awaited<ReturnType<typeof registerOrg>>, key: string) {
  return ((await org.owner.get('/roles')).body as any[]).find((r) => r.key === key).id as string;
}

describe('Staff with temporary passwords', () => {
  afterAll(closeApp);

  it('adds a staff member with a temporary password that must be replaced at first sign-in', async () => {
    const org = await registerOrg();
    const email = `${unique('temp')}@test.local`.toLowerCase();
    const sentBefore = mail().outbox.filter((m) => m.to === email).length;
    const res = await org.owner.post('/staff/with-temporary-password', { email, name: 'Temp Reception', roleIds: [await roleId(org, 'receptionist')], branchIds: [org.branchId] });
    expect(res.status).toBe(201);
    const temp = res.body.temporaryPassword as string;
    expect(temp).toMatch(TEMP);
    expect(res.body.member).toMatchObject({ status: 'ACTIVE', user: { email, mustChangePassword: true } });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
    expect(mail().outbox.filter((m) => m.to === email)).toHaveLength(sentBefore); // nothing emailed
    const audit = await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, action: 'membership.created_with_temporary_password' } });
    expect(audit?.summary).toBe(email);
    expect(JSON.stringify(audit)).not.toContain(temp);
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toContain(temp);

    // First sign-in: only the password change (and signing out) is possible.
    const c = new TestClient(await getApp());
    expect((await c.login(email, temp)).status).toBe(200);
    expect((await c.get('/auth/session')).body.user.mustChangePassword).toBe(true);
    const blocked = await c.get('/clients');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await c.post('/clients', { type: 'INDIVIDUAL', lastName: 'Nope', mobilePhone: '+92 300 0000000' })).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await c.post('/auth/change-password', { currentPassword: temp, newPassword: temp })).body.error.code).toBe('SAME_PASSWORD');
    expect((await c.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'MyOwnPass123' })).body.error.code).toBe('INVALID_PASSWORD');
    expect((await c.post('/auth/change-password', { currentPassword: temp, newPassword: 'MyOwnPass123' })).status).toBe(204);

    // Now a normal account: the temporary password no longer works, the new one does.
    expect((await c.get('/auth/session')).body.user.mustChangePassword).toBe(false);
    expect((await c.get('/clients')).status).toBe(200);
    expect((await new TestClient(await getApp()).login(email, temp)).status).toBe(401);
    expect((await new TestClient(await getApp()).login(email, 'MyOwnPass123')).status).toBe(200);
    expect(await prisma().user.findUniqueOrThrow({ where: { email } })).toMatchObject({ mustChangePassword: false, temporaryPasswordExpiresAt: null });
  });

  it('refuses existing accounts, expires unused temporary passwords and checks permissions', async () => {
    const org = await registerOrg();
    const other = await registerOrg();
    // An address that already has an account (here: another clinic's owner) is never given a new password.
    const taken = await org.owner.post('/staff/with-temporary-password', { email: other.email, name: 'Someone', roleIds: [await roleId(org, 'nurse')], branchIds: [org.branchId] });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/Send an invitation instead/);

    const email = `${unique('expire')}@test.local`.toLowerCase();
    const created = (await org.owner.post('/staff/with-temporary-password', { email, name: 'Late Starter', roleIds: [await roleId(org, 'nurse')], branchIds: [org.branchId] })).body;
    await prisma().user.update({ where: { email }, data: { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) } });
    const late = await new TestClient(await getApp()).login(email, created.temporaryPassword);
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('TEMPORARY_PASSWORD_EXPIRED');
    // The administrator issues a new one, which works.
    const again = await org.owner.post(`/staff/${created.member.id}/temporary-password`);
    expect(again.status).toBe(200);
    expect(again.body.temporaryPassword).not.toBe(created.temporaryPassword);
    expect((await new TestClient(await getApp()).login(email, again.body.temporaryPassword)).status).toBe(200);

    // Without users.manage: refused. Validation: roles and branches must belong to the clinic.
    const rec = await staff(org, 'receptionist');
    expect((await rec.client.post('/staff/with-temporary-password', { email: `${unique('x')}@test.local`, name: 'Xx', roleIds: [await roleId(org, 'nurse')], branchIds: [org.branchId] })).status).toBe(403);
    expect((await rec.client.post(`/staff/${created.member.id}/temporary-password`)).status).toBe(403);
    expect((await org.owner.post('/staff/with-temporary-password', { email: `${unique('y')}@test.local`, name: 'Yy', roleIds: [await roleId(other, 'nurse')], branchIds: [org.branchId] })).status).toBe(422);
    // Another clinic cannot touch this member.
    expect((await other.owner.post(`/staff/${created.member.id}/temporary-password`)).status).toBe(404);
  });

  it('issues a temporary password to an existing member only when the account belongs to this clinic alone', async () => {
    const org = await registerOrg();
    // A member who has signed in before: their sessions end when a temporary password is issued.
    const nurse = await staff(org, 'nurse');
    expect((await nurse.client.get('/auth/session')).status).toBe(200);
    const issued = await org.owner.post(`/staff/${nurse.membershipId}/temporary-password`);
    expect(issued.status).toBe(200);
    expect(issued.body.temporaryPassword).toMatch(TEMP);
    expect((await nurse.client.get('/auth/session')).status).toBe(401);
    expect((await new TestClient(await getApp()).login(nurse.email, PASSWORD)).status).toBe(401);
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: 'membership.temporary_password_issued', entityId: nurse.membershipId } })).toBe(1);

    // An invitation that never arrived: the invited member becomes active and the invitation link stops working.
    const email = `${unique('invited')}@test.local`.toLowerCase();
    const inv = (await org.owner.post('/staff/invite', { email, name: 'Never Got Email', roleIds: [await roleId(org, 'nurse')], branchIds: [org.branchId] })).body;
    const link = mail().outbox.filter((m) => m.to === email).pop()!;
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(link.text)![1]);
    const t = await org.owner.post(`/staff/${inv.id}/temporary-password`);
    expect(t.body.member.status).toBe('ACTIVE');
    expect((await new TestClient(await getApp()).get(`/auth/invitations/${encodeURIComponent(token)}`)).body.error.code).toBe('TOKEN_INVALID');

    // Refused: yourself, an owner (when you could not assign that role), and accounts also used at another clinic.
    const manager = await staff(org, 'practice_manager');
    const ownerMember = ((await org.owner.get('/staff')).body as any[]).find((m) => m.user.email === org.email);
    expect((await org.owner.post(`/staff/${ownerMember.id}/temporary-password`)).body.error.code).toBe('SELF_CHANGE');
    expect((await manager.client.post(`/staff/${ownerMember.id}/temporary-password`)).status).toBe(403);
    const otherOrg = await registerOrg();
    const shared = await staff(otherOrg, 'nurse');
    const join = await org.owner.post('/staff/invite', { email: shared.email, name: 'Shared Nurse', roleIds: [await roleId(org, 'nurse')], branchIds: [org.branchId] });
    expect(join.status).toBe(201);
    expect((await org.owner.post(`/staff/${join.body.id}/temporary-password`)).body.error.code).toBe('SHARED_ACCOUNT');
  });
});
