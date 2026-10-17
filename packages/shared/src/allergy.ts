/**
 * Allergy check for prescribing. A patient's allergy / medication alerts are matched against a product's
 * name, generic name, active ingredient(s) and drug class (family), case-insensitively and ignoring simple
 * plurals ("Penicillins" matches "penicillin"). Shared so the prescribing screen can warn before and as
 * soon as a product is picked; the API runs the same check and requires a documented override.
 *
 * This contains NO drug knowledge: which family a medicine belongs to is clinic-maintained product data
 * (Product.drugClass), entered from the clinic's own reference.
 */

export type AllergyMatchVia = 'name' | 'ingredient' | 'class';

export interface AllergyAlertLike {
  type: string;
  title: string;
  substance?: string | null;
}

export interface AllergyProductLike {
  name: string;
  genericName?: string | null;
  activeIngredients?: string[] | null;
  /** Drug class / family, e.g. "Penicillins" or "NSAIDs". Several may be separated by commas. */
  drugClass?: string | null;
}

export interface AllergyConflict<A> {
  alert: A;
  /** What on the product matched: its name, an ingredient, or its drug family. */
  via: AllergyMatchVia;
  /** The product text that matched, as written on the product (e.g. "Penicillins"). */
  term: string;
}

/** "Penicillins" → "penicillin", "NSAIDs" → "nsaid", "allergies" → "allergy"; "class" stays "class". */
function singular(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lower case, single spaces, each word without a plural "s". */
export function allergyKey(text: string) {
  return text
    .toLowerCase()
    .replace(/[()[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

/** "Penicillins, Beta-lactams" or "Penicillins / Cephalosporins" → separate entries. */
const splitList = (s: string) =>
  s
    .split(/[,;/+]|\band\b/i)
    .map((x) => x.trim())
    .filter(Boolean);

const MIN = 3;

/** Every allergy/medication alert that conflicts with the product, with what matched. */
export function allergyConflicts<A extends AllergyAlertLike>(alerts: A[], product: AllergyProductLike): AllergyConflict<A>[] {
  const terms = [
    { text: product.name, via: 'name' as const },
    ...(product.genericName ? [{ text: product.genericName, via: 'ingredient' as const }] : []),
    ...(product.activeIngredients ?? []).map((text) => ({ text, via: 'ingredient' as const })),
    ...(product.drugClass ? splitList(product.drugClass) : []).map((text) => ({ text, via: 'class' as const })),
  ]
    .map((t) => ({ ...t, key: allergyKey(t.text) }))
    .filter((t) => t.key.length >= MIN);
  const out: AllergyConflict<A>[] = [];
  for (const alert of alerts) {
    if (alert.type !== 'ALLERGY' && alert.type !== 'MEDICATION') continue;
    const substances = alert.substance ? splitList(alert.substance).map(allergyKey).filter((s) => s.length >= MIN) : [];
    const hay = allergyKey(`${alert.substance ?? ''} ${alert.title}`);
    // Most specific first: a drug family match explains itself better than a name match.
    const ordered = [...terms].sort((a, b) => (a.via === 'class' ? -1 : 0) - (b.via === 'class' ? -1 : 0));
    const hit = ordered.find((t) => hay.includes(t.key) || substances.some((s) => t.key.includes(s)));
    if (hit) out.push({ alert, via: hit.via, term: hit.text });
  }
  return out;
}

/** The alerts that conflict with the product (see `allergyConflicts`). */
export function allergyMatches<A extends AllergyAlertLike>(alerts: A[], product: AllergyProductLike): A[] {
  return allergyConflicts(alerts, product).map((c) => c.alert);
}

/** Plain sentence for a conflict: "Allergy “Penicillin” — Amoxicillin 250 mg tablets is in the drug family Penicillins". */
export function allergyConflictText(c: AllergyConflict<AllergyAlertLike>, productName: string) {
  const why = c.via === 'class' ? `is in the drug family ${c.term}` : c.via === 'ingredient' ? `contains ${c.term}` : 'matches by name';
  return `Allergy “${c.alert.substance || c.alert.title}” — ${productName} ${why}`;
}
