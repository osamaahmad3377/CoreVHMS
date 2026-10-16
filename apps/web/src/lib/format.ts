import { differenceInDays, differenceInMonths, differenceInYears, format, formatDistanceToNowStrict, isValid } from 'date-fns';
import { formatMoney } from '@vcms/shared';

const toDate = (d: string | Date | null | undefined) => (d ? (typeof d === 'string' ? new Date(d) : d) : null);

/** Unambiguous date (14 Oct 2026) — avoids dd/mm vs mm/dd confusion across PK, AU and US users. */
export function fmtDate(d: string | Date | null | undefined, fallback = '—') {
  const date = toDate(d);
  return date && isValid(date) ? format(date, 'd MMM yyyy') : fallback;
}

export function fmtDateTime(d: string | Date | null | undefined, fallback = '—') {
  const date = toDate(d);
  return date && isValid(date) ? format(date, 'd MMM yyyy, HH:mm') : fallback;
}

export function fmtTime(d: string | Date | null | undefined) {
  const date = toDate(d);
  return date && isValid(date) ? format(date, 'HH:mm') : '';
}

export function fmtRelative(d: string | Date | null | undefined) {
  const date = toDate(d);
  return date && isValid(date) ? `${formatDistanceToNowStrict(date)} ago` : '';
}

/** Age from date of birth: "3 y 4 m", "7 m", "12 d". */
export function fmtAge(dob: string | Date | null | undefined, estimated = false, until?: string | Date | null) {
  const date = toDate(dob);
  if (!date || !isValid(date)) return '—';
  const end = toDate(until) ?? new Date();
  const y = differenceInYears(end, date);
  const m = differenceInMonths(end, date) % 12;
  let s: string;
  if (y >= 1) s = m ? `${y} y ${m} m` : `${y} y`;
  else if (differenceInMonths(end, date) >= 1) s = `${differenceInMonths(end, date)} m`;
  else s = `${differenceInDays(end, date)} d`;
  return estimated ? `~${s}` : s;
}

export function fmtMoney(minor: number | null | undefined, currency = 'PKR') {
  return formatMoney(minor ?? 0, currency);
}

export function fmtWeight(kg: number | string | null | undefined) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const n = Number(kg);
  return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2).replace(/0$/, '')} kg`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
