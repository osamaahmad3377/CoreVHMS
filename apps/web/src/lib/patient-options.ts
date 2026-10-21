/** Common coat colours and patterns for the registration drop-down. Anything else is typed under "Other". */
export const COAT_COLOURS = [
  'Black', 'White', 'Brown', 'Tan', 'Grey', 'Cream', 'Golden', 'Red / ginger', 'Fawn', 'Chocolate',
  'Black & white', 'Brown & white', 'Black & tan', 'Tricolour', 'Brindle', 'Tabby', 'Calico', 'Tortoiseshell',
  'Spotted', 'Merle', 'Sable', 'Blue / grey',
];

/**
 * Blood groups worth recording, by species. Dogs are typed by DEA 1.1 and cats as A, B or AB; other species have
 * no common list, so they use "Other". These are labels for the record, not clinical rules.
 */
export function bloodTypeOptions(speciesName?: string | null): string[] {
  const n = (speciesName ?? '').toLowerCase();
  if (/\b(dog|canine)\b/.test(n)) return ['DEA 1.1 positive', 'DEA 1.1 negative'];
  if (/\b(cat|feline)\b/.test(n)) return ['A', 'B', 'AB'];
  return [];
}
