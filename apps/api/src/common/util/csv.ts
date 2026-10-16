/**
 * One CSV cell. Values that a spreadsheet would treat as a formula (=, +, -, @, tab, CR) are prefixed with
 * an apostrophe so an exported file can never execute anything when opened (CSV/formula injection).
 */
export function csvCell(v: unknown): string {
  let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
