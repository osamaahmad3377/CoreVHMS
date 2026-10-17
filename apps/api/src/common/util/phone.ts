/**
 * Digits to look for in the stored phone key when searching. Spaces, dashes and brackets are ignored and the
 * +92 / 0092 / leading 0 prefix is dropped, because phoneKey() stores numbers without it — so "0300 77",
 * "+92 300 77" and "30077" all find 0300 7712345. Returns null when the term has too few digits to be a phone search.
 */
export function phoneSearchDigits(term: string, minDigits = 4): string | null {
  const t = term.trim();
  // Only treat the term as a phone number when it is all digits and separators (not "Flat 12" or "INV-12").
  if (!/^[+\d\s()\-.]+$/.test(t)) return null;
  const typed = t.replace(/\D/g, '');
  if (typed.length < minDigits) return null;
  let digits = typed;
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (t.startsWith('+92') || (digits.startsWith('92') && digits.length >= 12)) digits = digits.slice(2);
  else if (t.startsWith('+')) return digits.slice(-10);
  digits = digits.replace(/^0+/, '');
  return digits.length >= 3 ? digits.slice(-10) : null;
}
