/**
 * Case-insensitive match of a patient's allergy/medication alerts against a product's name and active
 * ingredients. Shared so the prescribing screen can warn as soon as a product is picked; the API runs the
 * same check and requires a documented override.
 */
export function allergyMatches<A extends { type: string; title: string; substance?: string | null }>(alerts: A[], product: { name: string; genericName?: string | null; activeIngredients?: string[] | null }): A[] {
  const terms = [product.name, product.genericName ?? '', ...(product.activeIngredients ?? [])].map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  return alerts.filter((a) => {
    if (a.type !== 'ALLERGY' && a.type !== 'MEDICATION') return false;
    const hay = `${a.substance ?? ''} ${a.title}`.toLowerCase();
    return terms.some((t) => hay.includes(t) || (!!a.substance && a.substance.length >= 3 && t.includes(a.substance.toLowerCase())));
  });
}
