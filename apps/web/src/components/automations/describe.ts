import { CHECK_INFO, CONDITION_INFO, TRIGGER_INFO, type AutomationCondition, type AutomationDraft, type AutomationStep } from '@vcms/shared';
import { fmtDateOnly } from '@/lib/format';

export interface AutomationOptions {
  species: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  appointmentTypes: { id: string; name: string }[];
  staff: { id: string; name: string; jobTitle: string | null }[];
  channels: { whatsapp: boolean; email: { own: boolean; address: string | null } };
  services?: { id: string; name: string }[];
  /** Marketing: at most one offer per client every N days (null = no limit), everything paused, approval needed. */
  marketing?: { capDays: number | null; paused: boolean; approval: boolean };
}

const CHANNEL_WORD: Record<string, string> = { BEST: 'a message', WHATSAPP: 'a WhatsApp', EMAIL: 'an email', SMS: 'an SMS' };

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** "When a visit is finished" / "24 hours before an appointment" / "On a pet's birthday at 10:00". */
/** "Once on 1 Nov 2026", "Every month from 1 Nov 2026 until 30 Jun 2027". */
export function offerScheduleText(a: Pick<AutomationDraft, 'sendOn' | 'repeat' | 'endsOn' | 'atHour'>) {
  if (!a.sendOn) return 'Date not chosen yet';
  const from = fmtDateOnly(a.sendOn);
  const at = a.atHour != null ? ` at ${hourLabel(Number(a.atHour))}` : '';
  if (!a.repeat || a.repeat === 'NONE') return `Once on ${from}${at}${a.endsOn ? ` · offer ends ${fmtDateOnly(a.endsOn)}` : ''}`;
  return `${a.repeat === 'WEEKLY' ? 'Every week' : 'Every month'} from ${from}${at}${a.endsOn ? ` until ${fmtDateOnly(a.endsOn)}` : ''}`;
}

export function whenText(a: Pick<AutomationDraft, 'trigger' | 'offset' | 'atHour' | 'sendOn' | 'repeat' | 'endsOn'>) {
  const t = TRIGGER_INFO[a.trigger];
  const at = a.atHour != null ? ` at ${hourLabel(Number(a.atHour))}` : '';
  if (t.timed === 'ON_DATE') return `${offerScheduleText(a)}, to clients who agreed to marketing`;
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
    case 'patientSex':
      return `${not}${c.values.map((v) => v.toLowerCase()).join(' or ')}`;
    case 'ageAtLeast':
      return `${c.values[0]}+ years old`;
    case 'ageUnder':
      return `under ${c.values[0]} years old`;
    case 'firstVisit':
      return c.values.includes('FIRST') ? 'first visit' : 'returning client';
    case 'lastVisit':
      return c.op === 'IS_NOT' ? `not seen in the last ${c.values[0]} months` : `seen in the last ${c.values[0]} months`;
    case 'newClient':
      return c.op === 'IS_NOT' ? `clients for more than ${c.values[0]} days` : `joined in the last ${c.values[0]} days`;
    case 'visitsAtLeast':
      return `${not ? 'fewer than' : 'at least'} ${c.values[0]} visits in 12 months`;
    case 'spentAtLeast':
      return `${not ? 'spent less than' : 'spent at least'} ${Number(c.values[0]) / 100} in 12 months`;
    case 'boughtService':
      return `${not ? 'did not have' : 'had'} ${names(o?.services)} (12 months)`;
    case 'careDue':
      return c.op === 'IS_NOT' ? `no care due in the next ${c.values[0]} days` : `care due in the next ${c.values[0]} days (or overdue)`;
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
    case 'WAIT_UNTIL':
      return `wait until ${hourLabel(s.hour)}`;
  }
}

/** One sentence for the whole automation. */
export function describeAutomation(a: AutomationDraft, o?: AutomationOptions | null) {
  const conds = (a.conditions ?? []).map((c) => conditionText(c as AutomationCondition, o));
  const steps = (a.steps as AutomationStep[]).map(stepText);
  return `${whenText(a)}${conds.length ? ` (${conds.join(', ')})` : ''} → ${steps.join(' → ')}`;
}
