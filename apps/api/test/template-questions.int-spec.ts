import { STARTER_TEMPLATE_QUESTIONS } from '@vcms/shared';
import { closeApp, registerOrg, staff } from './helpers';

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
