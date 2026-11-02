import { closeApp, registerOrg, staff } from './helpers';

describe('Appointment categories', () => {
  afterAll(closeApp);

  it('starts every clinic with the ten built-in categories, and lets it add, rename, hide and remove its own', async () => {
    const org = await registerOrg();
    const start = (await org.owner.get('/appointment-categories')).body;
    expect(start.map((c: any) => c.name)).toEqual(['Consultation', 'Vaccination', 'Follow-up', 'Surgery', 'Dental', 'Diagnostics', 'Grooming', 'Emergency', 'Field visit', 'Other']);

    // A new category works like a built-in kind; appointment types in it take that kind.
    const senior = await org.owner.post('/appointment-categories', { name: 'Senior care', kind: 'CONSULTATION', sortOrder: 15 });
    expect(senior.status).toBe(201);
    expect((await org.owner.post('/appointment-categories', { name: 'Senior care', kind: 'OTHER' })).status).toBe(409);
    const t = await org.owner.post('/appointment-types', { name: 'Senior wellness exam', categoryId: senior.body.id, durationMinutes: 30 });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ category: 'CONSULTATION', categoryId: senior.body.id });

    // A type given only a built-in kind goes into that kind's category.
    const groom = await org.owner.post('/appointment-types', { name: 'Nail trim', category: 'GROOMING', durationMinutes: 15 });
    const grooming = start.find((c: any) => c.name === 'Grooming');
    expect(groom.body).toMatchObject({ category: 'GROOMING', categoryId: grooming.id });

    // Changing what a category works like changes its appointment types too.
    await org.owner.patch(`/appointment-categories/${senior.body.id}`, { name: 'Senior pets', kind: 'FOLLOW_UP' });
    const types = (await org.owner.get('/appointment-types?all=true')).body;
    expect(types.find((x: any) => x.name === 'Senior wellness exam')).toMatchObject({ category: 'FOLLOW_UP', categoryRef: { name: 'Senior pets', kind: 'FOLLOW_UP' } });
    // Moving a type to another category.
    const moved = await org.owner.patch(`/appointment-types/${t.body.id}`, { categoryId: grooming.id });
    expect(moved.body).toMatchObject({ category: 'GROOMING', categoryId: grooming.id });

    // Hidden categories leave the picker but stay on the full list; a used one can't be deleted.
    await org.owner.patch(`/appointment-categories/${senior.body.id}`, { isActive: false });
    expect((await org.owner.get('/appointment-categories')).body.map((c: any) => c.name)).not.toContain('Senior pets');
    expect((await org.owner.get('/appointment-categories?all=true')).body.map((c: any) => c.name)).toContain('Senior pets');
    expect((await org.owner.del(`/appointment-categories/${grooming.id}`)).body.error.code).toBe('IN_USE');
    expect((await org.owner.del(`/appointment-categories/${senior.body.id}`)).status).toBe(200);

    // Reception can see categories (for booking) but not change them; other clinics can't touch them.
    const desk = await staff(org, 'receptionist');
    expect((await desk.client.get('/appointment-categories')).status).toBe(200);
    expect((await desk.client.post('/appointment-categories', { name: 'Desk', kind: 'OTHER' })).status).toBe(403);
    const other = await registerOrg();
    expect((await other.owner.patch(`/appointment-categories/${grooming.id}`, { name: 'Hijack' })).status).toBe(404);
    expect((await other.owner.post('/appointment-types', { name: 'X', categoryId: grooming.id, durationMinutes: 15 })).body.error.code).toBe('INVALID_CATEGORY');
  });
});
