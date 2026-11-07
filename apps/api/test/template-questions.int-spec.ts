import { STANDARD_EXAM_SYSTEMS, STARTER_TEMPLATE_QUESTIONS } from '@vcms/shared';
import { closeApp, prisma, registerOrg, staff } from './helpers';

type Template = { id: string; name: string; icon: string; isActive: boolean; plan: string | null; diagnoses: string[]; questions: { ask: string; multi: boolean; answers: { label: string; text: string }[] }[] };

const own = {
  name: 'Tick fever check',
  icon: 'thermometer',
  presentingComplaint: 'Suspected tick fever',
  plan: 'Blood smear for parasites.',
  examSystems: ['Lymph nodes', 'General appearance'],
  diagnoses: ['Babesiosis (suspected)'],
  advice: ['Check the coat for ticks every day'],
  questions: [
    { ask: 'Ticks seen?', answers: [{ label: 'Yes', text: 'Ticks seen on the animal' }, { label: 'No', text: 'No ticks seen' }] },
    { ask: 'Signs?', multi: true, answers: [{ label: 'Fever', text: 'fever' }, { label: 'Pale gums', text: 'pale gums' }] },
  ],
};

describe('Consultation templates with questions (guided consultation)', () => {
  afterAll(closeApp);

  it('adds the starter questions to existing templates of the same name, and the rest as new templates — no vaccination', async () => {
    const org = await registerOrg();
    // A clinic that already has its own "Lameness" template (no questions) and one unrelated template.
    const lameness = await org.owner.post('/clinical-templates', { name: 'Lameness', plan: 'Rest and recheck.', examSystems: ['Musculoskeletal'] });
    await org.owner.post('/clinical-templates', { name: 'Bovine mastitis investigation' });
    expect(lameness.status).toBe(201);

    const list = (await org.owner.get('/clinical-templates')).body as Template[];
    // Lameness got the limping questions; its own note text and exam checklist are kept.
    const lame = list.find((t) => t.name === 'Lameness')!;
    expect(lame.questions[1].ask).toBe('Which leg?');
    expect(lame.plan).toBe('Rest and recheck.');
    expect(lame.icon).toBe('bone');
    // The unrelated template is untouched; the other starter sets became new templates.
    expect(list.find((t) => t.name === 'Bovine mastitis investigation')!.questions).toHaveLength(0);
    expect(list.find((t) => t.name === 'Ear problem')!.questions.length).toBeGreaterThan(0);
    expect(list.find((t) => t.name === 'Limping / pain')).toBeUndefined();
    expect(list.some((t) => /vaccin/i.test(t.name))).toBe(false);
    expect(list).toHaveLength(STARTER_TEMPLATE_QUESTIONS.length + 1);
    // Reading again adds nothing.
    expect((await org.owner.get('/clinical-templates')).body).toHaveLength(list.length);
  });

  it('gives a new clinic the common appointment types, each in its own category', async () => {
    const org = await registerOrg();
    const list = (await org.owner.get('/clinical-templates')).body as Template[];
    for (const name of ['Wellness check', 'Puppy / kitten first visit', 'Senior check', 'Dental check', 'Lump / mass', 'Seizure / neurological', 'Behaviour problem', 'Post-op check', 'Pre-surgery check', 'Emergency']) {
      expect(list.find((t) => t.name === name)!.questions.length).toBeGreaterThan(0);
    }
    // Each template has its appointment type (a clinic's existing "Dental" or "Emergency" type is reused).
    const types = await prisma().appointmentType.findMany({ where: { organizationId: org.orgId, template: { isNot: null } }, include: { categoryRef: true, template: true } });
    const kind = (name: string) => types.find((t) => t.template!.name === name);
    expect(kind('Dental check')).toMatchObject({ category: 'DENTAL' });
    expect(kind('Senior check')).toMatchObject({ category: 'CONSULTATION', durationMinutes: 20 });
    expect(kind('Post-op check')).toMatchObject({ category: 'FOLLOW_UP' });
    expect(kind('Pre-surgery check')).toMatchObject({ category: 'SURGERY' });
    expect(kind('Emergency')).toMatchObject({ category: 'EMERGENCY' });
    expect(kind('Ear problem')).toMatchObject({ category: 'CONSULTATION' });
    expect(kind('Dental check')!.categoryRef!.kind).toBe('DENTAL');
    expect(await prisma().organization.findUniqueOrThrow({ where: { id: org.orgId } })).toMatchObject({ templateLibraryVersion: 2 });
  });

  it('does not attach a new template to an appointment type the clinic switched off', async () => {
    const org = await registerOrg();
    const db = prisma();
    // The clinic has a "Dental" type and has switched it off.
    await db.appointmentType.updateMany({ where: { organizationId: org.orgId, name: 'Dental' }, data: { isActive: false } });
    if (!(await db.appointmentType.count({ where: { organizationId: org.orgId, name: 'Dental' } }))) {
      await db.appointmentType.create({ data: { organizationId: org.orgId, name: 'Dental', category: 'DENTAL', isActive: false } });
    }
    await org.owner.get('/clinical-templates');
    expect(await db.appointmentType.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Dental' } })).toMatchObject({ isActive: false, templateId: null });
    expect(await db.appointmentType.findFirstOrThrow({ where: { organizationId: org.orgId, name: 'Dental check' } })).toMatchObject({ isActive: true, category: 'DENTAL', durationMinutes: 20 });
  });

  it('upgrades a clinic on the first library once: improves untouched starter templates, keeps edited ones, adds only new ones', async () => {
    const org = await registerOrg();
    await org.owner.get('/clinical-templates');
    const db = prisma();
    const tpl = async (name: string) => db.clinicalTemplate.findFirstOrThrow({ where: { organizationId: org.orgId, name } });
    const remove = async (name: string) => {
      const t = await tpl(name);
      await db.appointmentType.deleteMany({ where: { templateId: t.id } });
      await db.clinicalTemplate.delete({ where: { id: t.id } });
    };
    // Put the clinic back on the first library: "Ear problem" exactly as the first library wrote it.
    const v1Ear = {
      name: 'Ear problem',
      icon: 'ear',
      presentingComplaint: 'Ear problem',
      examSystems: ['Ears', 'Skin & coat', ...STANDARD_EXAM_SYSTEMS.filter((x) => x !== 'Ears' && x !== 'Skin & coat')],
      diagnoses: ['Otitis externa', 'Ear mites', 'Foreign body in ear', 'Aural haematoma'],
      advice: ['Use the ear drops exactly as shown and finish the course', 'Do not put cotton buds into the ear canal', 'Come back if the ear gets more painful or swollen'],
      questions: [
        { ask: 'Since when?', answers: [{ label: 'Today', text: 'Started today' }, { label: '2–3 days', text: 'Started 2–3 days ago' }, { label: 'About a week', text: 'Going on for about a week' }, { label: 'Longer', text: 'Going on for more than a week' }] },
        { ask: 'Which side?', answers: [{ label: 'Left', text: 'Left side' }, { label: 'Right', text: 'Right side' }, { label: 'Both', text: 'Both sides' }] },
        { ask: 'What do you notice?', multi: true, answers: [{ label: 'Scratching', text: 'scratching the ear' }, { label: 'Head shaking', text: 'head shaking' }, { label: 'Smell', text: 'bad smell' }, { label: 'Discharge', text: 'discharge' }, { label: 'Pain', text: 'pain when touched' }] },
        { ask: 'Had this before?', answers: [{ label: 'First time', text: 'First time with this problem' }, { label: 'Before', text: 'Has had ear problems before' }] },
      ],
    };
    const put = await org.owner.patch(`/clinical-templates/${(await tpl('Ear problem')).id}`, v1Ear);
    expect(put.body.error ?? null).toBeNull();
    // The clinic's own changes: its own skin questions and its own diagnoses for eyes.
    const skin = await tpl('Skin / itching');
    await org.owner.patch(`/clinical-templates/${skin.id}`, { name: 'Skin / itching', icon: 'paw', diagnoses: ['Our own diagnosis'], advice: ['Our own advice'], examSystems: ['Skin & coat'], questions: [{ ask: 'Our own question?', answers: [{ label: 'Yes', text: 'Yes' }] }] });
    // A first-library template the clinic deleted, and a new-library one it does not have yet.
    await remove('Cough / breathing');
    await remove('Senior check');
    await db.organization.update({ where: { id: org.orgId }, data: { templateLibraryVersion: 1 } });

    const list = (await org.owner.get('/clinical-templates')).body as Template[];
    const ear = list.find((t) => t.name === 'Ear problem')!;
    expect(ear.questions.map((x) => x.ask)).toContain('Discharge colour?');
    expect(ear.diagnoses).toContain('Otitis media (suspected)');
    const ownSkin = list.find((t) => t.name === 'Skin / itching')!;
    expect(ownSkin.questions.map((x) => x.ask)).toEqual(['Our own question?']);
    expect(ownSkin.diagnoses).toEqual(['Our own diagnosis']);
    expect(list.find((t) => t.name === 'Cough / breathing')).toBeUndefined();
    expect(list.find((t) => t.name === 'Senior check')!.questions.length).toBeGreaterThan(0);
    expect(await db.appointmentType.count({ where: { organizationId: org.orgId, name: 'Senior check' } })).toBe(1);
    const events = () => db.auditEvent.findMany({ where: { organizationId: org.orgId, action: 'template.library_updated' } });
    const [event] = await events();
    expect(event.summary).toContain('Ear problem');
    expect(event.summary).not.toContain('Skin / itching');
    expect(event.summary).toContain('Added: Senior check');
    // Once only.
    await org.owner.get('/clinical-templates');
    expect(await events()).toHaveLength(1);
  });

  it('lets the clinic write its own templates and questions, edit them in order, and restore the starter questions', async () => {
    const org = await registerOrg();
    await org.owner.get('/clinical-templates');
    const created = await org.owner.post('/clinical-templates', own);
    expect(created.status).toBe(201);
    expect(created.body.questions.map((q: { ask: string }) => q.ask)).toEqual(['Ticks seen?', 'Signs?']);
    expect(created.body.questions[1]).toMatchObject({ multi: true });
    expect((await org.owner.post('/clinical-templates', { ...own, name: 'TICK fever check' })).status).toBe(422);

    // Editing replaces the questions in the order given.
    const edited = await org.owner.patch(`/clinical-templates/${created.body.id}`, { ...own, questions: [{ ask: 'Appetite?', answers: [{ label: 'Normal', text: 'Eating normally' }] }, own.questions[0]] });
    expect(edited.status).toBe(200);
    expect(edited.body.questions.map((q: { ask: string }) => q.ask)).toEqual(['Appetite?', 'Ticks seen?']);
    // An older screen that sends no questions leaves them as they are.
    const textOnly = await org.owner.patch(`/clinical-templates/${created.body.id}`, { name: own.name, plan: 'Changed plan.' });
    expect(textOnly.body.plan).toBe('Changed plan.');
    expect(textOnly.body.questions).toHaveLength(2);

    // Clearing the questions of a starter template, then restoring, puts them back.
    const ear = ((await org.owner.get('/clinical-templates')).body as Template[]).find((t) => t.name === 'Ear problem')!;
    await org.owner.patch(`/clinical-templates/${ear.id}`, { name: ear.name, questions: [] });
    expect(((await org.owner.get('/clinical-templates')).body as Template[]).find((t) => t.id === ear.id)!.questions).toHaveLength(0);
    expect((await org.owner.post('/clinical-templates/restore-starter')).body.added).toBe(1);
    expect(((await org.owner.get('/clinical-templates')).body as Template[]).find((t) => t.id === ear.id)!.questions.length).toBeGreaterThan(0);
  });

  it('is read by vets, changed only with settings access, validated, audited and private to each clinic', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian');
    expect((await vet.client.get('/clinical-templates')).status).toBe(200);
    expect((await vet.client.post('/clinical-templates', own)).status).toBe(403);
    expect((await vet.client.post('/clinical-templates/restore-starter')).status).toBe(403);
    for (const bad of [{ ...own, icon: 'not-an-icon' }, { ...own, questions: [{ ask: 'No answers?', answers: [] }] }, { ...own, questions: [{ ask: '', answers: [{ label: 'x' }] }] }]) {
      expect((await org.owner.post('/clinical-templates', bad)).status).toBe(400);
    }

    const t = await org.owner.post('/clinical-templates', own);
    const other = await registerOrg();
    expect(((await other.owner.get('/clinical-templates?all=true')).body as Template[]).find((x) => x.name === own.name)).toBeUndefined();
    expect((await other.owner.patch(`/clinical-templates/${t.body.id}`, own)).status).toBe(404);

    await org.owner.patch(`/clinical-templates/${t.body.id}`, { ...own, questions: [own.questions[1]] });
    const log = await org.owner.get('/audit-events?entityType=ClinicalTemplate');
    expect(JSON.stringify(log.body)).toContain('template.updated');
    expect(JSON.stringify(log.body)).toContain('Ticks seen?');
  });
});
