import { MessagesService } from '../src/modules/comms/messages.service';
import { TestClient, closeApp, getApp, mail, makeClient, prisma, registerOrg, staff } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);
const image = (name: string) => ({ buffer: PNG, name, type: 'image/png' });

// White label: a clinic's name, logo, icon and colours. Only the clinic owner can change them.
describe('Clinic branding (owner only)', () => {
  afterAll(closeApp);

  it('starts with the clinic name and default colours, and the owner can change them', async () => {
    const org = await registerOrg('Happy Paws Clinic');
    expect((await org.owner.get('/organization/branding')).body).toMatchObject({
      brandName: 'Happy Paws Clinic', primaryColor: null, sidebarColor: null, logoUrl: null, iconUrl: null, hasOwnIcon: false,
    });

    const saved = await org.owner.call('put', '/organization/branding', {
      brandName: 'Happy Paws', primaryColor: '#2563EB', sidebarColor: '#0f172a', loginHeadline: 'Welcome back', loginMessage: 'Open 9–5. Call 042 111 222 for help.',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ brandName: 'Happy Paws', primaryColor: '#2563eb', sidebarColor: '#0f172a', loginHeadline: 'Welcome back' });
    expect((await org.owner.call('put', '/organization/branding', { primaryColor: 'blue' })).status).toBe(400);

    // Everyone's session carries the branding, so the whole app shows it.
    const session = (await org.owner.get('/auth/session')).body;
    expect(session.organization.branding).toMatchObject({ brandName: 'Happy Paws', primaryColor: '#2563eb' });
    // The clinic's legal name is unchanged.
    expect(session.organization.name).toBe('Happy Paws Clinic');

    const audit = await prisma().auditEvent.findFirst({ where: { organizationId: org.orgId, action: 'organization.branding_updated' } });
    expect(audit?.changes).toMatchObject({ brandName: { from: null, to: 'Happy Paws' }, primaryColor: { from: null, to: '#2563eb' } });

    // Clearing the name falls back to the clinic name.
    expect((await org.owner.call('put', '/organization/branding', { brandName: '' })).body.brandName).toBe('Happy Paws Clinic');
  });

  it('uploads a logo and a separate browser-tab icon', async () => {
    const org = await registerOrg();
    const logo = await org.owner.upload('/attachments', { entityType: 'Branding', entityId: org.orgId, category: 'logo' }, image('logo.png'));
    expect(logo.status).toBe(201);
    const b = (await org.owner.post('/organization/logo', { attachmentId: logo.body.id })).body;
    expect(b.logoUrl).toMatch(/^\/api\/v1\/organization\/logo\?v=\d+$/);
    // Without its own icon, the tab icon is the logo.
    expect(b).toMatchObject({ hasOwnIcon: false, iconUrl: expect.stringMatching(/\/organization\/icon\?v=/) });
    expect((await org.owner.get('/organization/logo')).headers['content-type']).toBe('image/png');
    expect((await org.owner.get('/organization/icon')).status).toBe(200);

    const icon = await org.owner.upload('/attachments', { entityType: 'Branding', entityId: org.orgId, category: 'icon' }, image('icon.png'));
    expect((await org.owner.post('/organization/icon', { attachmentId: icon.body.id })).body.hasOwnIcon).toBe(true);
    expect((await org.owner.post('/organization/icon', { attachmentId: null })).body.hasOwnIcon).toBe(false);

    // Only images uploaded for branding can be used, and only this clinic's.
    const other = await org.owner.upload('/attachments', { entityType: 'Organization', entityId: org.orgId }, image('x.png'));
    expect((await org.owner.post('/organization/logo', { attachmentId: other.body.id })).body.error.code).toBe('INVALID_LOGO');
    const elsewhere = await registerOrg();
    expect((await elsewhere.owner.post('/organization/logo', { attachmentId: logo.body.id })).body.error.code).toBe('INVALID_LOGO');

    // Staff see the logo; removing it leaves no logo or icon.
    const vet = await staff(org, 'veterinarian', { isClinician: true });
    expect((await vet.client.get('/organization/logo')).status).toBe(200);
    expect((await org.owner.post('/organization/logo', { attachmentId: null })).body).toMatchObject({ logoUrl: null, iconUrl: null });
  });

  it('nobody but the owner can change branding — not even a practice manager', async () => {
    const org = await registerOrg();
    const manager = await staff(org, 'practice_manager');
    expect(manager.client.session.permissions).toContain('settings.manage');
    expect(manager.client.session.permissions).not.toContain('branding.manage');
    expect((await manager.client.get('/organization/branding')).status).toBe(403);
    expect((await manager.client.call('put', '/organization/branding', { primaryColor: '#dc2626' })).status).toBe(403);
    expect((await manager.client.post('/organization/logo', { attachmentId: null })).status).toBe(403);
    expect((await manager.client.upload('/attachments', { entityType: 'Branding', entityId: org.orgId }, image('logo.png'))).status).toBe(403);
    // They still see the clinic's branding in their session.
    expect(manager.client.session.organization.branding.brandName).toBe(manager.client.session.organization.name);

    // The permission cannot be given to any other role, even by the owner.
    const catalogue = (await org.owner.get('/roles/permissions')).body as { permissions: { permission: string }[] }[];
    expect(catalogue.flatMap((g) => g.permissions.map((p) => p.permission))).not.toContain('branding.manage');
    const role = await org.owner.post('/roles', { name: 'Marketing', permissions: ['dashboard.view', 'branding.manage'] });
    expect(role.status).toBe(422);
    expect(role.body.error.code).toBe('OWNER_ONLY_PERMISSION');
    const roles = (await org.owner.get('/roles')).body as any[];
    const pm = roles.find((r) => r.key === 'practice_manager');
    expect((await org.owner.patch(`/roles/${pm.id}`, { permissions: [...pm.permissions, 'branding.manage'] })).body.error.code).toBe('OWNER_ONLY_PERMISSION');
  });

  it('saves the look, sign-in page, printout and email settings, and uploads the extra images', async () => {
    const org = await registerOrg('Meadow Vets');
    const saved = await org.owner.call('put', '/organization/branding', {
      brandFont: 'POPPINS', cornerStyle: 'ROUNDED', defaultTheme: 'SYSTEM',
      loginLayout: 'CENTERED', loginBackground: 'GRADIENT', loginFooter: '12 Mall Road, Lahore · meadowvets.pk',
      printLogoPosition: 'CENTER', printHeaderText: 'Companion & farm animals', printFooterText: 'Bank: HBL 1234', printUseBrandColour: false,
      printRule: 'DOUBLE', printLogoSize: 'LARGE', printShowTaxNumber: false, printPreprinted: true, printTopSpaceMm: 55, printFooterAlign: 'RIGHT',
      emailSenderName: 'Meadow Vets Lahore', emailSignature: 'The Meadow team\n042 111 222',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ brandFont: 'POPPINS', cornerStyle: 'ROUNDED', defaultTheme: 'SYSTEM', loginLayout: 'CENTERED', loginBackground: 'GRADIENT', printLogoPosition: 'CENTER', printUseBrandColour: false, printRule: 'DOUBLE', printLogoSize: 'LARGE', printShowTaxNumber: false, printPreprinted: true, printTopSpaceMm: 55, printFooterAlign: 'RIGHT', emailSenderName: 'Meadow Vets Lahore' });
    expect((await org.owner.get('/auth/session')).body.organization.branding).toMatchObject({ brandFont: 'POPPINS', loginFooter: '12 Mall Road, Lahore · meadowvets.pk' });
    for (const bad of [{ brandFont: 'COMIC_SANS' }, { emailSenderName: 'x <evil@example.com>' }, { printFooterText: 'x'.repeat(301) }, { printTopSpaceMm: 500 }, { printRule: 'WAVY' }]) {
      expect((await org.owner.call('put', '/organization/branding', bad)).status).toBe(400);
    }

    for (const kind of ['logo-dark', 'login-background'] as const) {
      const up = await org.owner.upload('/attachments', { entityType: 'Branding', entityId: org.orgId, category: kind }, image(`${kind}.png`));
      const set = await org.owner.post(`/organization/${kind}`, { attachmentId: up.body.id });
      expect(set.status).toBe(200);
      expect((await org.owner.get(`/organization/${kind}`)).headers['content-type']).toBe('image/png');
    }
    const b = (await org.owner.get('/organization/branding')).body;
    expect(b.logoDarkUrl).toMatch(/^\/api\/v1\/organization\/logo-dark\?v=/);
    expect(b.loginBackgroundUrl).toMatch(/^\/api\/v1\/organization\/login-background\?v=/);

    const manager = await staff(org, 'practice_manager');
    expect((await manager.client.post('/organization/logo-dark', { attachmentId: null })).status).toBe(403);
    expect((await manager.client.post('/organization/login-background', { attachmentId: null })).status).toBe(403);
  });

  it('client emails come from the clinic: sender name, reply-to and signature', async () => {
    const org = await registerOrg('Harbour Vets');
    await org.owner.patch('/organization', { email: 'hello@harbourvets.test' });
    await org.owner.call('put', '/organization/branding', { emailSenderName: 'Harbour Vets', emailSignature: 'Harbour Vets · 02 9999 0000' });
    const client = await makeClient(org.owner, { email: `client-${Date.now()}@example.test` });
    expect((await org.owner.post('/messages', { clientId: client.id, channel: 'EMAIL', subject: 'Results', body: 'Your results are ready.' })).status).toBe(201);
    await (await getApp()).get(MessagesService).dispatch();
    const m = mail().outbox.filter((x) => x.to === client.email).pop()!;
    expect(m.from).toMatch(/^"Harbour Vets" <[^>]+>$/);
    expect(m.replyTo).toBe('hello@harbourvets.test');
    expect(m.text).toContain('Your results are ready.\n\n-- \nHarbour Vets · 02 9999 0000');
    expect(m.html).toContain('Harbour Vets · 02 9999 0000');
  });

  it('emails to staff carry the clinic’s name and colour', async () => {
    const org = await registerOrg('Sunrise Animal Hospital');
    await org.owner.call('put', '/organization/branding', { brandName: 'Sunrise Vets', primaryColor: '#7c3aed' });
    const vet = await staff(org, 'veterinarian');
    const invite = mail().outbox.filter((m) => m.to === vet.email).pop()!;
    expect(invite.subject).toBe('You’re invited to join Sunrise Animal Hospital'.replace('’', "'"));
    expect(invite.html).toContain('background:#7c3aed');
    expect(invite.html).toContain('Sunrise Vets');
    expect(invite.html).not.toContain('NextCore');

    await new TestClient(await getApp()).post('/auth/forgot-password', { email: vet.email });
    const reset = mail().outbox.filter((m) => m.to === vet.email).pop()!;
    expect(reset.subject).toBe('Reset your Sunrise Vets password');
    expect(reset.html).toContain('background:#7c3aed');
  });
});
