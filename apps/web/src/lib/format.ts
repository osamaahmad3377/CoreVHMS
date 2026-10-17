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

/**
 * Date-only values (Postgres `date`, sent as UTC midnight — e.g. a batch's placedOn): show the calendar
 * date itself. Going through `new Date()` would shift it a day in time zones behind UTC.
 */
export function fmtDateOnly(d: string | Date | null | undefined, fallback = '—') {
  if (!d) return fallback;
  const day = (typeof d === 'string' ? d : isValid(d) ? d.toISOString() : '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? format(new Date(`${day}T00:00:00`), 'd MMM yyyy') : fallback;
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
/** Counts and quantities with thousands separators: 2,909 · 4,416.5 */
export function fmtNumber(n: number | string | null | undefined, fallback = '—') {
  if (n === null || n === undefined || n === '') return fallback;
  const v = Number(n);
  return Number.isFinite(v) ? numberFormat.format(v) : fallback;
}

let regionNames: Intl.DisplayNames | null | undefined;
/** Country name for an ISO 3166 code ("PK" → "Pakistan"); falls back to the code itself. */
export function fmtCountry(code: string | null | undefined) {
  if (!code) return '';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return (/^[A-Za-z]{2}$/.test(code) && regionNames?.of(code.toUpperCase())) || code;
  } catch {
    return code;
  }
}
