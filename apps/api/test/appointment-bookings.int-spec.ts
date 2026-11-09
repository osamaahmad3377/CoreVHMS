import { booking, closeApp, futureDate, karachi, prisma, registerOrg, schedulingFixture } from './helpers';

describe('Appointments list (Calendar & appointments → Appointments)', () => {
  afterAll(closeApp);

  it('lists every booking with search, kinds (online, home visits, clinic), status and counts', async () => {
    const org = await registerOrg();
    const f = await schedulingFixture(org);
    const day = futureDate(5);
    const clinic = await org.owner.post('/appointments', booking(org, f, karachi(day, '09:00'), { reason: 'Ear check' }));
    const home = await org.owner.post('/appointments', booking(org, f, karachi(day, '11:00'), { location: 'HOME', visitAddress: 'House 7, Street 2, Gulberg III, Lahore', travelMinutes: 0 }));
    const later = await org.owner.post('/appointments', booking(org, f, karachi(day, '14:00'), { reason: 'Vaccination' }));
    for (const r of [clinic, home, later]) expect(r.status).toBe(201);
    // As if booked on the online booking page.
    await prisma().appointment.update({ where: { id: later.body.id }, data: { source: 'ONLINE' } });
    await org.owner.post(`/appointments/${clinic.body.id}/status`, { action: 'confirm' });

    const list = (q: string) => org.owner.get(`/appointments/bookings?branchId=${org.branchId}&${q}`);
    const all = await list('when=upcoming');
    expect(all.status).toBe(200);
    expect(all.body.data.map((a: { id: string }) => a.id)).toEqual([clinic.body.id, home.body.id, later.body.id]); // next first
    expect(all.body.counts).toEqual({ all: 3, online: 1, home: 1, clinic: 2 });
    expect(all.body.meta).toMatchObject({ page: 1, total: 3 });

    expect((await list('kind=online')).body.data.map((a: { id: string }) => a.id)).toEqual([later.body.id]);
    expect((await list('kind=home')).body.data).toEqual([expect.objectContaining({ id: home.body.id, location: 'HOME', visitAddress: 'House 7, Street 2, Gulberg III, Lahore' })]);
    // To confirm: booked but not yet confirmed.
    expect((await list('status=toConfirm')).body.data.map((a: { id: string }) => a.id)).toEqual([home.body.id, later.body.id]);
    // Search by reason, by booking number, and by the client's name; counts follow the search.
    expect((await list('q=vaccin')).body.counts).toEqual({ all: 1, online: 1, home: 0, clinic: 1 });
    expect((await list(`q=${clinic.body.appointmentNo}`)).body.data.map((a: { id: string }) => a.id)).toEqual([clinic.body.id]);
    expect((await list(`q=${encodeURIComponent(f.client.displayName)}`)).body.meta.total).toBe(3);
    // Past: none yet; pages.
    expect((await list('when=past')).body.meta.total).toBe(0);
    const page2 = await list('when=all&pageSize=2&page=2');
    expect(page2.body.data).toHaveLength(1);
  });
});
