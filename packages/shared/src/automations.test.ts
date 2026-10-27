import { recipeKeyOf, AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, TRIGGER_DEFAULTS, automationSchema, conditionsMet, sampleVars, TRIGGER_INFO, waitMs } from './automations';

describe('automation conditions', () => {
  const facts = { speciesId: 'dog', branchId: 'lhr', appointmentTypeId: 'vacc', hasWhatsApp: true, hasEmail: false, amountMinor: 600000, source: 'ONLINE' as const };
  it('matches is / is not on ids', () => {
    expect(conditionsMet([{ field: 'species', op: 'IS', values: ['dog', 'cat'] }], facts)).toBe(true);
    expect(conditionsMet([{ field: 'species', op: 'IS_NOT', values: ['dog'] }], facts)).toBe(false);
    expect(conditionsMet([{ field: 'branch', op: 'IS', values: ['isb'] }], facts)).toBe(false);
  });
  it('checks how the client can be reached', () => {
    expect(conditionsMet([{ field: 'contact', op: 'IS', values: ['EMAIL'] }], facts)).toBe(false);
    expect(conditionsMet([{ field: 'contact', op: 'IS', values: ['EMAIL', 'WHATSAPP'] }], facts)).toBe(true);
  });
  it('compares amounts and requires every condition', () => {
    expect(conditionsMet([{ field: 'amountAtLeast', op: 'IS', values: ['500000'] }], facts)).toBe(true);
    expect(conditionsMet([{ field: 'amountAtLeast', op: 'IS', values: ['500000'] }, { field: 'source', op: 'IS', values: ['STAFF'] }], facts)).toBe(false);
  });
  it('checks sex, age and first visit', () => {
    const f = { patientSex: 'FEMALE' as const, ageYears: 8, firstVisit: true };
    expect(conditionsMet([{ field: 'patientSex', op: 'IS', values: ['FEMALE'] }], f)).toBe(true);
    expect(conditionsMet([{ field: 'ageAtLeast', op: 'IS', values: ['7'] }], f)).toBe(true);
    expect(conditionsMet([{ field: 'ageUnder', op: 'IS', values: ['7'] }], f)).toBe(false);
    expect(conditionsMet([{ field: 'firstVisit', op: 'IS', values: ['FIRST'] }], f)).toBe(true);
    expect(conditionsMet([{ field: 'firstVisit', op: 'IS', values: ['RETURNING'] }], f)).toBe(false);
    expect(conditionsMet([{ field: 'ageAtLeast', op: 'IS', values: ['1'] }], {})).toBe(false);
  });
  it('treats a condition the trigger cannot answer as not met', () => {
    expect(conditionsMet([{ field: 'appointmentType', op: 'IS', values: ['vacc'] }], { speciesId: 'dog' })).toBe(false);
  });
});

describe('automation rules', () => {
  const base = { name: 'x', trigger: 'APPOINTMENT_COMPLETED' as const, steps: [{ type: 'SEND_MESSAGE' as const, body: 'Hi' }] };
  it('needs something to do and no wait at the end', () => {
    expect(automationSchema.safeParse(base).success).toBe(true);
    expect(automationSchema.safeParse({ ...base, steps: [{ type: 'WAIT', amount: 1, unit: 'HOURS' }] }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, steps: [...base.steps, { type: 'WAIT', amount: 1, unit: 'HOURS' }] }).success).toBe(false);
  });
  it('needs the hours before for "before an appointment"', () => {
    expect(automationSchema.safeParse({ ...base, trigger: 'APPOINTMENT_UPCOMING' }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, trigger: 'APPOINTMENT_UPCOMING', offset: 24 }).success).toBe(true);
  });
  it('every recipe is valid and only uses its trigger’s variables', () => {
    for (const r of AUTOMATION_RECIPES) {
      expect(automationSchema.safeParse(r.automation).success).toBe(true);
      const allowed = new Set(TRIGGER_INFO[r.automation.trigger].variables);
      for (const s of r.automation.steps) {
        const text = 'body' in s ? `${s.body} ${'subject' in s ? s.subject ?? '' : ''}` : 'title' in s ? s.title : '';
        for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) expect(allowed.has(m[1])).toBe(true);
      }
    }
  });
  it('allows a check only where it applies, and never as the last step', () => {
    const check = { type: 'CHECK' as const, check: 'STILL_UNPAID' as const };
    const msg = { type: 'SEND_MESSAGE' as const, body: 'Hi' };
    expect(automationSchema.safeParse({ name: 'x', trigger: 'INVOICE_OVERDUE', offset: 7, steps: [msg, check, msg] }).success).toBe(true);
    expect(automationSchema.safeParse({ name: 'x', trigger: 'APPOINTMENT_COMPLETED', steps: [msg, check, msg] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: 'x', trigger: 'INVOICE_OVERDUE', offset: 7, steps: [msg, check] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: 'x', trigger: 'PATIENT_LAPSED', steps: [msg] }).success).toBe(false);
  });
  it('gives sample values and wait lengths', () => {
    expect(sampleVars('PET_BIRTHDAY').petName).toBe('Tiger');
    expect(waitMs({ amount: 2, unit: 'HOURS' })).toBe(7_200_000);
  });

  it('suggested wording exists for every trigger and only uses that trigger’s values', () => {
    for (const t of AUTOMATION_TRIGGERS) {
      const d = TRIGGER_DEFAULTS[t];
      const allowed = new Set(TRIGGER_INFO[t].variables);
      for (const m of `${d.subject} ${d.body} ${d.taskTitle}`.matchAll(/\{\{(\w+)\}\}/g)) expect([t, allowed.has(m[1])]).toEqual([t, true]);
      expect(automationSchema.safeParse({ name: 'x', trigger: t, offset: 7, steps: [{ type: 'SEND_MESSAGE', body: d.body }, { type: 'CREATE_TASK', title: d.taskTitle }] }).success).toBe(true);
    }
  });
});

describe('ready-made or the clinic’s own', () => {
  it('stays ready-made while it keeps the recipe’s shape, whatever the wording', () => {
    const r = AUTOMATION_RECIPES.find((x) => x.key === 'payment')!;
    const a = { ...r.automation, name: 'Thanks for paying', conditions: r.automation.conditions ?? [] } as never;
    expect(recipeKeyOf(a, 'payment')).toBe('payment');
    // Older automations are recognised by the recipe's name.
    expect(recipeKeyOf({ ...r.automation, conditions: [] } as never)).toBe('payment');
    // A different shape (an extra step) makes it the clinic's own; an unknown key counts for nothing.
    expect(recipeKeyOf({ ...r.automation, conditions: [], steps: [{ type: 'WAIT', amount: 1, unit: 'HOURS' }, ...r.automation.steps] } as never, 'payment')).toBeNull();
    expect(recipeKeyOf({ ...r.automation, name: 'Mine', conditions: [] } as never, 'nope')).toBeNull();
  });
});
