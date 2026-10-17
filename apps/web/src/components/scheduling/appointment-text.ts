import { branchTime, localDate, shiftDate, todayIn } from '@/lib/time';
import type { Appointment } from '@/lib/types';

type ApptLike = Pick<Appointment, 'startsAt' | 'appointmentNo'> & {
  patient?: { name: string } | null;
  client?: { displayName: string } | null;
  clinician?: { name: string } | null;
};

/** "today 16:55", "tomorrow 11:00" or "Tue 20 Oct at 11:00", in the branch's time zone. */
export function apptWhen(startsAt: string | Date, tz: string) {
  const day = localDate(startsAt, tz);
  const today = todayIn(tz);
  const time = branchTime(startsAt, tz);
  if (day === today) return `today ${time}`;
  if (day === shiftDate(today, 1)) return `tomorrow ${time}`;
  return `${branchTime(startsAt, tz, 'EEE d MMM')} at ${time}`;
}

/** Who the appointment is for: the patient's name, or the client's when no patient is set. */
export const apptWho = (a: ApptLike) => a.patient?.name ?? a.client?.displayName ?? 'Appointment';

/** Plain sentence for a toast, codes at the end: "Moti, Tue 20 Oct at 11:00 with Dr Ayesha Raza (A-000123)". */
export function apptSummary(a: ApptLike, tz: string, opts: { withVet?: boolean } = {}) {
  const vet = opts.withVet !== false && a.clinician ? ` with ${a.clinician.name}` : '';
  return `${apptWho(a)}, ${apptWhen(a.startsAt, tz)}${vet} (${a.appointmentNo})`;
}

/** Toast text after a status change from the appointment window or the front desk board. */
export function statusChangeMessage(action: string, a: ApptLike, tz: string): string {
  const who = apptWho(a);
  switch (action) {
    case 'confirm':
      return `Owner confirmed: ${apptSummary(a, tz, { withVet: false })}`;
    case 'check-in':
      return `Checked in: ${who} (${a.appointmentNo})`;
    case 'start':
      return `Consultation started: ${who} (${a.appointmentNo})`;
    case 'complete':
      return `Visit finished: ${who} (${a.appointmentNo})`;
    case 'no-show':
      return `Marked as no-show: ${apptSummary(a, tz, { withVet: false })}`;
    case 'revert':
      return `Undone: ${who} (${a.appointmentNo})`;
    case 'cancel':
      return `Appointment cancelled: ${apptSummary(a, tz, { withVet: false })}`;
    default:
      return `Appointment updated: ${apptSummary(a, tz, { withVet: false })}`;
  }
}

/** "9 h 12 min", "45 min" — easier to read than "552 min". */
export function fmtWait(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
