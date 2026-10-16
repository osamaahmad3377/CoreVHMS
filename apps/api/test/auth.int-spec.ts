import { authenticator } from 'otplib';
import { PASSWORD, TestClient, closeApp, getApp, mail, prisma, registerOrg, staff } from './helpers';

describe('Authentication', () => {
  afterAll(closeApp);

  it('registers an organization with system roles, a branch and starter catalogue', async () => {
    const org = await registerOrg();
    expect(org.owner.session.user.email).toBe(org.email);
    expect(org.owner.session.permissions).toContain('roles.manage');
    const roles = (await org.owner.get('/roles')).body;
    expect(roles.map((r: any) => r.key)).toEqual(expect.arrayContaining(['owner', 'veterinarian', 'receptionist']));
    const species = (await org.owner.get('/species')).body;
    expect(species.find((s: any) => s.name === 'Buffalo')).toBeTruthy();
  });

  it('rejects unauthenticated access and bad credentials without revealing account existence', async () => {
    const c = new TestClient(await getApp());
    expect((await c.get('/clients')).status).toBe(401);
    const org = await registerOrg();
    const wrong = await c.login(org.email, 'WrongPassword1');
    const unknown = await c.login('nobody@test.local', 'WrongPassword1');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    const org = await registerOrg();
    const c = new TestClient(await getApp());
    for (let i = 0; i < 5; i++) await c.login(org.email, 'WrongPassword1');
    const res = await c.login(org.email, PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const org = await registerOrg();
    const csrf = org.owner.csrf;
    org.owner.csrf = '';
    const res = await org.owner.post('/branches', { name: 'B', code: 'B1', timezone: 'Asia/Karachi' });
    expect(res.status).toBe(403);
    org.owner.csrf = csrf;
    expect((await org.owner.post('/branches', { name: 'B', code: 'B1', timezone: 'Asia/Karachi' })).status).toBe(201);
  });

  it('logs out and revokes the session', async () => {
    const org = await registerOrg();
    expect((await org.owner.post('/auth/logout')).status).toBe(204);
    expect((await org.owner.get('/auth/session')).status).toBe(401);
  });

  it('resets a password through an emailed single-use token and revokes sessions', async () => {
    const org = await registerOrg();
    const anon = new TestClient(await getApp());
    expect((await anon.post('/auth/forgot-password', { email: org.email })).status).toBe(202);
    const msg = mail().outbox.filter((m) => m.to === org.email).pop()!;
    const token = decodeURIComponent(/token=([^\s"&]+)/.exec(msg.text)![1]);
    expect((await anon.post('/auth/reset-password', { token, password: 'weak' })).status).toBe(400);
    expect((await anon.post('/auth/reset-password', { token, password: 'BrandNew12345' })).status).toBe(204);
    expect((await anon.post('/auth/reset-password', { token, password: 'BrandNew12345' })).status).toBe(422);
    expect((await org.owner.get('/auth/session')).status).toBe(401);
    expect((await anon.login(org.email, 'BrandNew12345')).status).toBe(200);
  });

  it('supports TOTP multi-factor authentication with recovery codes', async () => {
    const org = await registerOrg();
    const setup = await org.owner.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect((await org.owner.post('/auth/mfa/enable', { code: '000000' })).status).toBe(422);
    const enable = await org.owner.post('/auth/mfa/enable', { code: authenticator.generate(secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(8);

    const c = new TestClient(await getApp());
    const step1 = await c.login(org.email);
    expect(step1.body.mfaRequired).toBe(true);
    expect((await c.get('/auth/session')).status).toBe(401);
    const bad = await c.post('/auth/mfa/verify', { challengeId: step1.body.challengeId, code: '123456' });
    expect(bad.status).toBe(401);
    const ok = await c.post('/auth/mfa/verify', { challengeId: step1.body.challengeId, code: authenticator.generate(secret) });
    expect(ok.status).toBe(200);
    expect((await c.get('/auth/session')).status).toBe(200);

    // recovery code works once
    const c2 = new TestClient(await getApp());
    const s2 = await c2.login(org.email);
    const code = enable.body.recoveryCodes[0];
    expect((await c2.post('/auth/mfa/verify', { challengeId: s2.body.challengeId, code })).status).toBe(200);
    const c3 = new TestClient(await getApp());
    const s3 = await c3.login(org.email);
    expect((await c3.post('/auth/mfa/verify', { challengeId: s3.body.challengeId, code })).status).toBe(401);
  });

  it('invites staff who join with their own password; suspension revokes access', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    expect(vet.client.session.organization.id).toBe(org.orgId);
    expect(vet.client.session.permissions).toContain('clinical.sign');
    expect(vet.client.session.permissions).not.toContain('roles.manage');

    const clinicians = (await org.owner.get('/staff/clinicians')).body;
    expect(clinicians.map((c: any) => c.name)).toContain('Test veterinarian');

    expect((await org.owner.patch(`/staff/${vet.membershipId}`, { status: 'SUSPENDED' })).status).toBe(200);
    expect((await vet.client.get('/auth/session')).status).toBe(401);
  });

  it('writes audit events for authentication and keeps them append-only', async () => {
    const org = await registerOrg();
    const events = (await org.owner.get('/audit-events?action=auth.')).body.data;
    expect(events.some((e: any) => e.action === 'auth.login')).toBe(true);
    await expect(prisma().$executeRawUnsafe(`UPDATE "AuditEvent" SET action = 'tampered'`)).rejects.toThrow(/append-only/);
  });
});
