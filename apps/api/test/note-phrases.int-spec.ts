import { DEFAULT_NOTE_PHRASES, NOTE_PHRASE_FIELDS } from '@vcms/shared';
import { closeApp, registerOrg, staff } from './helpers';

const starterTotal = NOTE_PHRASE_FIELDS.reduce((n, f) => n + DEFAULT_NOTE_PHRASES[f].length, 0);

describe('Quick note phrases', () => {
  afterAll(closeApp);

  it('starts with a starter set, which the clinic can change, switch off and restore', async () => {
    const org = await registerOrg();
    const first = await org.owner.get('/note-phrases');
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(starterTotal);
    // Starter phrases carry no doses, and grouped ones are choices of one question.
    expect(first.body.some((p: { field: string; groupName: string | null }) => p.field === 'subjective' && p.groupName === 'Eating')).toBe(true);
    // Reading again must not add them twice.
    expect((await org.owner.get('/note-phrases')).body).toHaveLength(starterTotal);

    const added = await org.owner.post('/note-phrases', { field: 'objective', label: 'Maggot wound', text: 'Wound with maggots.' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ field: 'objective', label: 'Maggot wound', text: 'Wound with maggots.', isActive: true });
    expect((await org.owner.post('/note-phrases', { field: 'objective', label: 'Maggot wound' })).status).toBe(422);

    const switchedOff = await org.owner.patch(`/note-phrases/${added.body.id}`, { isActive: false });
    expect(switchedOff.status).toBe(200);
    expect((await org.owner.get('/note-phrases')).body.find((p: { id: string }) => p.id === added.body.id)).toBeUndefined();
    expect((await org.owner.get('/note-phrases?all=true')).body.find((p: { id: string }) => p.id === added.body.id)).toBeTruthy();

    // Removing every phrase does not bring the starter set back by itself; restoring does, and keeps own phrases.
    const all = (await org.owner.get('/note-phrases?all=true')).body as { id: string }[];
    for (const p of all) expect((await org.owner.del(`/note-phrases/${p.id}`)).status).toBe(200);
    expect((await org.owner.get('/note-phrases')).body).toHaveLength(0);
    const restored = await org.owner.post('/note-phrases/restore-starter');
    expect(restored.body.added).toBe(starterTotal);
    expect((await org.owner.post('/note-phrases/restore-starter')).body.added).toBe(0);
  });

  it('can be read by clinical staff, changed only with settings access, and is private to each clinic', async () => {
    const org = await registerOrg();
    const vet = await staff(org, 'veterinarian');
    const rec = await staff(org, 'receptionist');
    expect((await vet.client.get('/note-phrases')).status).toBe(200);
    expect((await vet.client.post('/note-phrases', { field: 'plan', label: 'My own' })).status).toBe(403);
    expect((await rec.client.get('/note-phrases')).status).toBe(403);

    const phrase = await org.owner.post('/note-phrases', { field: 'plan', label: 'Clinic only' });
    const other = await registerOrg();
    expect((await other.owner.get('/note-phrases')).body.find((p: { label: string }) => p.label === 'Clinic only')).toBeUndefined();
    expect((await other.owner.patch(`/note-phrases/${phrase.body.id}`, { label: 'Hijack' })).status).toBe(404);
    expect((await other.owner.del(`/note-phrases/${phrase.body.id}`)).status).toBe(404);
    for (const bad of [{ field: 'nonsense', label: 'x' }, { field: 'plan', label: '' }]) expect((await org.owner.post('/note-phrases', bad)).status).toBe(400);
  });
});
