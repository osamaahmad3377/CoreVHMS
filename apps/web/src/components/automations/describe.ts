import { CHECK_INFO, CONDITION_INFO, TRIGGER_INFO, type AutomationCondition, type AutomationDraft, type AutomationStep } from '@vcms/shared';

export interface AutomationOptions {
  species: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  appointmentTypes: { id: string; name: string }[];
  staff: { id: string; name: string; jobTitle: string | null }[];
  channels: { whatsapp: boolean; email: { own: boolean; address: string | null } };
}

const CHANNEL_WORD: Record<string, string> = { BEST: 'a message', WHATSAPP: 'a WhatsApp', EMAIL: 'an email', SMS: 'an SMS' };

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** "When a visit is finished" / "24 hours before an appointment" / "On a pet's birthday at 10:00". */
export function whenText(a: Pick<AutomationDraft, 'trigger' | 'offset' | 'atHour'>) {
  const t = TRIGGER_INFO[a.trigger];
  const at = a.atHour != null ? ` at ${hourLabel(Number(a.atHour))}` : '';
  if (t.timed === 'HOURS_BEFORE') return `${a.offset ?? 24} hours before ${a.trigger === 'SURGERY_UPCOMING' ? 'a surgery' : 'an appointment'}`;
  if (t.timed === 'DAYS_AFTER') return `${a.offset ?? 7} days after an invoice was due (still unpaid)${at}`;
  if (t.timed === 'MONTHS_SINCE') return `${a.offset ?? 12} months after an animal’s last visit (nothing booked)${at}`;
  if (t.timed === 'DAYS_BEFORE') return Number(a.offset ?? 0) === 0 ? `On the day care is due${at}` : `${a.offset} days before care is due${at}`;
  if (t.timed === 'ON_DAY') return `On a pet’s birthday${at}`;
  return `When ${t.when}`;
}

export function conditionText(c: AutomationCondition, o?: AutomationOptions | null) {
  const names = (list?: { id: string; name: string }[]) => c.values.map((v) => list?.find((x) => x.id === v)?.name ?? '…').join(' or ');
  const not = c.op === 'IS_NOT' ? 'not ' : '';
  switch (c.field) {
    case 'species':
      return `${not}${names(o?.species)}`;
    case 'branch':
      return `${not}at ${names(o?.branches)}`;
    case 'appointmentType':
      return `${not}${names(o?.appointmentTypes)} appointments`;
    case 'contact':
      return `client ${c.op === 'IS_NOT' ? 'cannot' : 'can'} be reached by ${c.values.map((v) => (v === 'WHATSAPP' ? 'WhatsApp' : 'email')).join(' or ')}`;
    case 'amountAtLeast':
      return `${not}${Number(c.values[0]) / 100} or more`;
    case 'source':
      return `${not}booked ${c.values.map((v) => (v === 'ONLINE' ? 'online' : 'by staff')).join(' or ')}`;
  }
  return CONDITION_INFO[c.field as keyof typeof CONDITION_INFO]?.label ?? '';
}

export function stepText(s: AutomationStep) {
  switch (s.type) {
    case 'SEND_MESSAGE':
      return `send ${CHANNEL_WORD[s.channel] ?? 'a message'}`;
    case 'WAIT':
      return `wait ${s.amount} ${s.unit.toLowerCase().replace(/s$/, s.amount === 1 ? '' : 's')}`;
    case 'CREATE_TASK':
      return 'create a task';
    case 'EMAIL_TEAM':
      return `email ${s.to || 'the team'}`;
    case 'CHECK':
      return `only if ${CHECK_INFO[s.check].label}`;
  }
}

/** One sentence for the whole automation. */
export function describeAutomation(a: AutomationDraft, o?: AutomationOptions | null) {
  const conds = (a.conditions ?? []).map((c) => conditionText(c as AutomationCondition, o));
  const steps = (a.steps as AutomationStep[]).map(stepText);
  return `${whenText(a)}${conds.length ? ` (${conds.join(', ')})` : ''} → ${steps.join(' → ')}`;
}
