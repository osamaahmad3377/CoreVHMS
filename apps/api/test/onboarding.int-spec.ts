import { closeApp, makeClient, registerOrg, staff } from './helpers';

describe('Setup checklist', () => {
  afterAll(closeApp);

  it('derives progress from real configuration and is limited to administrators', async () => {
    const org = await registerOrg();
    const before = (await org.owner.get('/setup/status')).body;
    expect(before.total).toBe(10);
    expect(before.steps.find((s: any) => s.key === 'client').done).toBe(false);
    await makeClient(org.owner);
    await org.owner.post('/services', { code: 'C1', name: 'Consult', priceMinor: 100 });
    const after = (await org.owner.get('/setup/status')).body;
    expect(after.steps.find((s: any) => s.key === 'client').done).toBe(true);
    expect(after.steps.find((s: any) => s.key === 'services').done).toBe(false); // still needs a tax rate
    await org.owner.post('/tax-rates', { name: 'Zero', rateBasisPoints: 0 });
    expect((await org.owner.get('/setup/status')).body.steps.find((s: any) => s.key === 'services').done).toBe(true);
    const reception = await staff(org, 'receptionist');
    expect((await reception.client.get('/setup/status')).status).toBe(403);
  });
});
