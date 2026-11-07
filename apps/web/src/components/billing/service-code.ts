/**
 * A short code for a service made from its name (e.g. “Full groom” → FULL-GROOM), unique among `taken`. Codes are
 * for reports and invoices; staff rarely need to type one.
 */
export function codeFromName(name: string, taken: string[]): string {
  const base =
    name
      .toUpperCase()
      .normalize('NFKD')
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'SERVICE';
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
