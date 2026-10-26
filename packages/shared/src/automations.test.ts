import { AUTOMATION_RECIPES, automationSchema, conditionsMet, sampleVars, TRIGGER_INFO, waitMs } from './automations';

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
  it('gives sample values and wait lengths', () => {
    expect(sampleVars('PET_BIRTHDAY').petName).toBe('Tiger');
    expect(waitMs({ amount: 2, unit: 'HOURS' })).toBe(7_200_000);
  });
});
