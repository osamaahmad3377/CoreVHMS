import { recipeKeyOf, AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, TRIGGER_DEFAULTS, automationSchema, conditionsMet, sampleVars, TRIGGER_INFO, waitMs, nextOfferDay, offerDayOnOrBefore } from './automations';

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
      // An offer's date is chosen when the recipe is used.
      expect(automationSchema.safeParse(r.automation.trigger === 'SCHEDULED_OFFER' ? { ...r.automation, sendOn: '2026-11-01' } : r.automation).success).toBe(true);
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
      expect(automationSchema.safeParse({ name: 'x', trigger: t, offset: 7, ...(t === 'SCHEDULED_OFFER' ? { sendOn: '2026-11-01', marketing: true } : {}), steps: [{ type: 'SEND_MESSAGE', body: d.body }, { type: 'CREATE_TASK', title: d.taskTitle }] }).success).toBe(true);
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

describe('offers on a date', () => {
  it('works out when an offer goes out: once, every week or every month, until it ends', () => {
    const once = { sendOn: '2026-11-01', repeat: 'NONE' as const };
    expect(offerDayOnOrBefore(once, '2026-10-31')).toBeNull();
    expect(offerDayOnOrBefore(once, '2026-11-01')).toBe('2026-11-01');
    expect(offerDayOnOrBefore(once, '2026-11-20')).toBe('2026-11-01');
    expect(nextOfferDay(once, '2026-11-02')).toBeNull();
    const weekly = { sendOn: '2026-11-02', repeat: 'WEEKLY' as const, endsOn: '2026-11-30' };
    expect(offerDayOnOrBefore(weekly, '2026-11-15')).toBe('2026-11-09');
    expect(nextOfferDay(weekly, '2026-11-15')).toBe('2026-11-16');
    expect(offerDayOnOrBefore(weekly, '2026-12-20')).toBe('2026-11-30');
    expect(nextOfferDay(weekly, '2026-12-01')).toBeNull();
    // The 31st becomes the last day of shorter months.
    const monthly = { sendOn: '2026-01-31', repeat: 'MONTHLY' as const };
    expect(offerDayOnOrBefore(monthly, '2026-02-27')).toBe('2026-01-31');
    expect(offerDayOnOrBefore(monthly, '2026-02-28')).toBe('2026-02-28');
    expect(nextOfferDay(monthly, '2026-03-01')).toBe('2026-03-31');
    expect(offerDayOnOrBefore({ sendOn: null }, '2026-11-01')).toBeNull();
  });

  it('chooses clients by their animals and their last visit', () => {
    const dogOwner = { speciesIds: ['dog', 'cat'], monthsSinceVisit: 14 };
    expect(conditionsMet([{ field: 'species', op: 'IS', values: ['dog'] }], dogOwner)).toBe(true);
    expect(conditionsMet([{ field: 'species', op: 'IS_NOT', values: ['dog'] }], dogOwner)).toBe(false);
    expect(conditionsMet([{ field: 'lastVisit', op: 'IS', values: ['12'] }], dogOwner)).toBe(false);
    expect(conditionsMet([{ field: 'lastVisit', op: 'IS_NOT', values: ['12'] }], dogOwner)).toBe(true);
    // Never visited counts as "not within".
    expect(conditionsMet([{ field: 'lastVisit', op: 'IS_NOT', values: ['12'] }], { monthsSinceVisit: null })).toBe(true);
  });

  it('needs a date, is always promotional, and ends after it starts', () => {
    const base = { name: 'Offer', trigger: 'SCHEDULED_OFFER', marketing: true, sendOn: '2026-11-01', repeat: 'NONE', steps: [{ type: 'SEND_MESSAGE', body: 'Hello' }] };
    expect(automationSchema.safeParse(base).success).toBe(true);
    expect(automationSchema.safeParse({ ...base, sendOn: null }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, marketing: false }).success).toBe(false);
    expect(automationSchema.safeParse({ ...base, endsOn: '2026-10-01' }).success).toBe(false);
    // The offer recipes are complete once a date is chosen.
    for (const r of AUTOMATION_RECIPES.filter((x) => x.automation.trigger === 'SCHEDULED_OFFER')) {
      expect(automationSchema.safeParse({ ...r.automation, sendOn: '2026-11-01' }).success).toBe(true);
    }
  });
});

describe('marketing audiences', () => {
  const client = { speciesIds: ['dog'], petSexes: ['FEMALE' as const], petAges: [0, 9], visits12m: 5, spent12mMinor: 2_500_000, serviceIds12m: ['groom'], careDueInDays: 12, daysAsClient: 3, monthsSinceVisit: 1 };
  const yes = (field: string, values: string[], op: 'IS' | 'IS_NOT' = 'IS') => conditionsMet([{ field: field as never, op, values }], client);
  it('chooses clients by their animals, visits, spending, services, care due and when they joined', () => {
    expect([yes('ageUnder', ['1']), yes('ageAtLeast', ['7']), yes('ageAtLeast', ['10'])]).toEqual([true, true, false]);
    expect([yes('patientSex', ['FEMALE']), yes('patientSex', ['MALE'])]).toEqual([true, false]);
    expect([yes('visitsAtLeast', ['4']), yes('visitsAtLeast', ['6'])]).toEqual([true, false]);
    expect([yes('spentAtLeast', ['2000000']), yes('spentAtLeast', ['3000000'])]).toEqual([true, false]);
    expect([yes('boughtService', ['groom']), yes('boughtService', ['groom'], 'IS_NOT')]).toEqual([true, false]);
    expect([yes('careDue', ['30']), yes('careDue', ['7']), yes('careDue', ['30'], 'IS_NOT')]).toEqual([true, false, false]);
    expect([yes('newClient', ['7']), yes('newClient', ['7'], 'IS_NOT')]).toEqual([true, false]);
    // Nothing known counts as not matching.
    expect(conditionsMet([{ field: 'careDue', op: 'IS', values: ['30'] }], {})).toBe(false);
  });

  it('has themed ready-made campaigns, all valid offers or promotional automations', () => {
    const marketing = AUTOMATION_RECIPES.filter((r) => r.automation.marketing);
    expect(marketing.length).toBeGreaterThanOrEqual(12);
    expect(marketing.every((r) => r.theme)).toBe(true);
  });
});
