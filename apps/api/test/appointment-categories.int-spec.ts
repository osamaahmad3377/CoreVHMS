import { closeApp, registerOrg, staff } from './helpers';

describe('Appointment categories', () => {
  afterAll(closeApp);

  it('starts every clinic with the built-in categories and Deworming, and lets it add, rename, hide and remove its own', async () => {
    const org = await registerOrg();
    const start = (await org.owner.get('/appointment-categories')).body;
    expect(start.map((c: any) => c.name)).toEqual(['Consultation', 'Vaccination', 'Deworming', 'Follow-up', 'Surgery', 'Dental', 'Diagnostics', 'Grooming', 'Emergency', 'Field visit', 'Other']);
    // Deworming is preventive care like vaccination, and the starter Deworming appointment type is in it.
    expect(start.find((c: any) => c.name === 'Deworming')).toMatchObject({ kind: 'VACCINATION' });
    const deworming = ((await org.owner.get('/appointment-types?all=true')).body as any[]).find((t) => t.name === 'Deworming');
    expect(deworming).toMatchObject({ category: 'VACCINATION', categoryRef: { name: 'Deworming' } });

    // A new category works like a built-in kind; appointment types in it take that kind.
    const senior = await org.owner.post('/appointment-categories', { name: 'Senior care', kind: 'CONSULTATION', sortOrder: 15 });
    expect(senior.status).toBe(201);
    expect((await org.owner.post('/appointment-categories', { name: 'Senior care', kind: 'OTHER' })).status).toBe(409);
    const t = await org.owner.post('/appointment-types', { name: 'Senior wellness exam', categoryId: senior.body.id, durationMinutes: 30 });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ category: 'CONSULTATION', categoryId: senior.body.id });

    // A type given only a built-in kind goes into that kind's category.
    const groom = await org.owner.post('/appointment-types', { name: 'Claw clip', category: 'GROOMING', durationMinutes: 15 });
    const grooming = start.find((c: any) => c.name === 'Grooming');
    expect(groom.body).toMatchObject({ category: 'GROOMING', categoryId: grooming.id });

    // Changing what a category works like changes its appointment types too.
    await org.owner.patch(`/appointment-categories/${senior.body.id}`, { name: 'Senior pets', kind: 'FOLLOW_UP' });
    const types = (await org.owner.get('/appointment-types?all=true')).body;
    expect(types.find((x: any) => x.name === 'Senior wellness exam')).toMatchObject({ category: 'FOLLOW_UP', categoryRef: { name: 'Senior pets', kind: 'FOLLOW_UP' } });
    // Moving a type to another category.
    const moved = await org.owner.patch(`/appointment-types/${t.body.id}`, { categoryId: grooming.id });
    expect(moved.body).toMatchObject({ category: 'GROOMING', categoryId: grooming.id });

    // Clearing a type's category keeps it in a category of its kind (a type always has one).
    const cleared = await org.owner.patch(`/appointment-types/${groom.body.id}`, { categoryId: null });
    expect(cleared.body).toMatchObject({ category: 'GROOMING', categoryId: grooming.id });

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

describe('Appointment types with their consultation templates', () => {
  afterAll(closeApp);

  it('gives every consultation template an appointment type, and lets a type use any template', async () => {
    const org = await registerOrg();
    await org.owner.get('/clinical-templates'); // the starter templates arrive on first use
    const types = (await org.owner.get('/appointment-types?all=true')).body as any[];
    const byName = (n: string) => types.find((t) => t.name === n);

    // A starter template becomes a type in Consultation, charged like the consultation.
    const consult = byName('Consultation');
    expect(byName('Ear problem')).toMatchObject({ category: 'CONSULTATION', categoryRef: { name: 'Consultation' }, template: { name: 'Ear problem' }, serviceId: consult.serviceId });
    expect(byName('Ear problem').template._count.questions).toBeGreaterThan(0);
    // Starter templates of another name join their starter type instead of making a second one.
    expect(consult.template).toMatchObject({ name: 'General consultation' });
    expect(byName('Follow-up').template).toMatchObject({ name: 'Recheck / follow-up' });
    expect(byName('General consultation')).toBeUndefined();

    // A template made later gets its type too; one with the name of a type without a template joins it.
    const breeding = await org.owner.post('/appointment-types', { name: 'Breeding check', category: 'CONSULTATION', durationMinutes: 30 });
    const tpl = await org.owner.post('/clinical-templates', { name: 'Breeding check', examSystems: [] });
    expect(tpl.status).toBe(201);
    const blood = await org.owner.post('/clinical-templates', { name: 'Blood donor screen', examSystems: [] });
    let after = (await org.owner.get('/appointment-types?all=true')).body as any[];
    expect(after.find((t) => t.id === breeding.body.id).template).toMatchObject({ id: tpl.body.id });
    expect(after.find((t) => t.name === 'Blood donor screen')).toMatchObject({ category: 'CONSULTATION', template: { id: blood.body.id } });

    // Any type can use a template; another clinic's template is refused.
    const surgery = byName('Surgery');
    expect((await org.owner.patch(`/appointment-types/${surgery.id}`, { templateId: tpl.body.id })).status).toBe(200);
    after = (await org.owner.get('/appointment-types?all=true')).body as any[];
    expect(after.find((t) => t.id === surgery.id).template).toMatchObject({ name: 'Breeding check' });
    const other = await registerOrg();
    expect((await other.owner.patch(`/appointment-types/${(await other.owner.get('/appointment-types')).body[0].id}`, { templateId: tpl.body.id })).status).toBe(404);
  });
});
