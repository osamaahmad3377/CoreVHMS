/**
 * The bill at the shop counter, in sections: what the vet charged for the visit, what was given in the clinic,
 * the prescribed medicines, then anything bought from the shop.
 */
export const POS_BILL_SECTIONS = [
  { key: 'SERVICES', label: 'Consultation & services' },
  { key: 'GIVEN', label: 'Given in the clinic' },
  { key: 'PRESCRIBED', label: 'Prescribed medicines' },
  { key: 'SHOP', label: 'Shop items' },
] as const;
export type PosBillSection = (typeof POS_BILL_SECTIONS)[number]['key'];

/** Which section a waiting charge belongs to, by what created it. */
export function chargeSection(sourceType: string): PosBillSection {
  if (sourceType === 'Dispensation') return 'PRESCRIBED';
  if (sourceType === 'Administration' || sourceType === 'CareItem' || sourceType === 'GroupTreatment') return 'GIVEN';
  return 'SERVICES';
}
