import { z } from 'zod';

/**
 * Optional areas a clinic can switch off under Settings → Services you offer.
 * Switching one off only hides its menu items, shortcuts and dashboard panels; no data is ever deleted.
 */
export const OPTIONAL_MODULES = ['hospital', 'surgery', 'lab', 'livestock', 'boarding', 'insurance'] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];

export const OPTIONAL_MODULE_INFO: Record<OptionalModule, { label: string; description: string }> = {
  hospital: { label: 'Hospital (admitted patients)', description: 'Animals that stay with you overnight, with their treatment sheets.' },
  surgery: { label: 'Surgery', description: 'Booking operations, anaesthesia records and the safety checklist.' },
  lab: { label: 'Lab & X-ray', description: 'Ordering tests, recording results and X-ray reports.' },
  livestock: { label: 'Livestock & farms', description: 'Farm visits, herds, cattle, goats and other farm animals.' },
  boarding: { label: 'Boarding & grooming', description: 'Pets staying in your kennels, and grooming appointments.' },
  insurance: { label: 'Insurance & referrals', description: 'Pet insurance claims and sending patients to other vets.' },
};

/** Enabled optional modules, given the organization's stored list of switched-off ones. */
export function enabledModules(disabled: readonly string[] | null | undefined): OptionalModule[] {
  const off = new Set(disabled ?? []);
  return OPTIONAL_MODULES.filter((m) => !off.has(m));
}

export const clinicModulesSchema = z.object({
  enabled: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length),
});
export type ClinicModulesInput = z.infer<typeof clinicModulesSchema>;
