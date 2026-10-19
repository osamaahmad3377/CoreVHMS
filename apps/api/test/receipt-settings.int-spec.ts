import { closeApp, prisma, registerOrg, staff } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('Receipts & printing settings', () => {
  afterAll(closeApp);

  it('serves defaults, saves the layout, and prints the branding logo or a separate receipt logo', async () => {
    const org = await registerOrg();
    const first = (await org.owner.get('/receipt-settings')).body;
    expect(first.settings).toMatchObject({ paperWidthMm: 80, sideMarginMm: 3, showLogo: true, logoSource: 'BRANDING', logoWidthPercent: 55, copies: 1, updatedAt: null });
    expect(first).toMatchObject({ brandingLogo: false, logoVersion: null });
    expect(first.branches.map((b: any) => b.id)).toEqual([org.branchId]);
    expect((await org.owner.get('/receipt-settings/logo')).status).toBe(404);

    // Branding logo is used by default.
    const brand = await org.owner.upload('/attachments', { entityType: 'Branding', entityId: org.orgId, category: 'logo' }, { buffer: PNG, name: 'logo.png', type: 'image/png' });
    await org.owner.post('/organization/logo', { attachmentId: brand.body.id });
    const withBrand = (await org.owner.get('/receipt-settings')).body;
    expect(withBrand).toMatchObject({ brandingLogo: true, logoVersion: brand.body.id });
    const logo = await org.owner.get('/receipt-settings/logo');
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');

    // A separate receipt logo, sized and aligned; 58 mm paper.
    const own = await org.owner.upload('/attachments', { entityType: 'ReceiptLogo', entityId: org.orgId, category: 'logo' }, { buffer: PNG, name: 'receipt-logo.png', type: 'image/png' });
    expect(own.status).toBe(201);
    const body = { ...withBrand.settings, paperWidthMm: 58, logoSource: 'CUSTOM', customLogoAttachmentId: own.body.id, logoWidthPercent: 40, logoAlign: 'LEFT', headerText: 'Open 9–9 every day', footerText: 'See you soon!', policyText: 'Unopened items can be returned within 7 days.', showEmail: true, autoPrint: true, copies: 2 };
    delete body.updatedAt;
    delete body.updatedByName;
    const saved = await org.owner.call('put', '/receipt-settings', body);
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({ paperWidthMm: 58, logoSource: 'CUSTOM', logoWidthPercent: 40, logoAlign: 'LEFT', copies: 2, autoPrint: true, updatedByName: 'Olivia Owner' });
    expect(saved.body.logoVersion).toBe(own.body.id);

    // Validation.
    expect((await org.owner.call('put', '/receipt-settings', { ...body, paperWidthMm: 100 })).status).toBe(400);
    expect((await org.owner.call('put', '/receipt-settings', { ...body, logoWidthPercent: 5 })).status).toBe(400);
    expect((await org.owner.call('put', '/receipt-settings', { ...body, customLogoAttachmentId: null })).body.error.code).toBe('LOGO_REQUIRED');
    expect((await org.owner.call('put', '/receipt-settings', { ...body, customLogoAttachmentId: brand.body.id })).body.error.code).toBe('INVALID_LOGO');

    // Audited once per save; logo downloads are not audited (they happen on every print).
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: 'receipt_settings.updated' } })).toBe(1);
    expect(await prisma().auditEvent.count({ where: { organizationId: org.orgId, action: 'attachment.downloaded' } })).toBe(0);
  });

  it('lets the counter read the layout but only settings managers change it; clinics are separate', async () => {
    const org = await registerOrg();
    const rec = await staff(org, 'receptionist');
    const r = await rec.client.get('/receipt-settings');
    expect(r.status).toBe(200);
    const body = { ...r.body.settings };
    delete body.updatedAt;
    delete body.updatedByName;
    expect((await rec.client.call('put', '/receipt-settings', { ...body, title: 'Hacked' })).status).toBe(403);
    const lab = await staff(org, 'lab_technician');
    expect((await lab.client.get('/receipt-settings')).status).toBe(403);

    const other = await registerOrg();
    const theirLogo = await other.owner.upload('/attachments', { entityType: 'ReceiptLogo', entityId: other.orgId }, { buffer: PNG, name: 'x.png', type: 'image/png' });
    expect((await org.owner.call('put', '/receipt-settings', { ...body, logoSource: 'CUSTOM', customLogoAttachmentId: theirLogo.body.id })).body.error.code).toBe('INVALID_LOGO');
    expect((await org.owner.upload('/attachments', { entityType: 'ReceiptLogo', entityId: other.orgId }, { buffer: PNG, name: 'y.png', type: 'image/png' })).status).toBe(404);
  });
});
