import { z } from 'zod';
import { VISIT_LOCATIONS } from './enums';
import { optMapUrl } from './schemas/scheduling';

/** Settings → Online booking. */
export const onlineBookingSettingsSchema = z.object({
  enabled: z.boolean(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/, 'Use 3–50 lowercase letters, numbers and dashes, e.g. city-vet-clinic'),
  daysAhead: z.coerce.number().int().min(1, 'At least 1 day').max(365, 'At most 365 days'),
  minNoticeHours: z.coerce.number().int().min(0).max(336),
  cancelNoticeHours: z.coerce.number().int().min(0).max(336),
  branchIds: z.array(z.string().uuid()).max(50).default([]),
  clinicianIds: z.array(z.string().uuid()).max(200).default([]),
  allowNewClients: z.boolean(),
  autoConfirm: z.boolean(),
  /** Clients can ask for a home visit as well as a visit at the clinic (needs Home visits switched on). */
  allowHomeVisits: z.boolean().default(false),
  welcomeMessage: z.string().trim().max(500).optional().or(z.literal('')),
  /** Appointment types clients can choose online. */
  appointmentTypeIds: z.array(z.string().uuid()).max(100).default([]),
  /**
   * Categories with no appointment type yet to offer online (e.g. Vaccination, Deworming): one is added for each
   * when saved. A category id, or `new:vaccination` / `new:deworming` when the clinic has no such category.
   */
  offerCategoryIds: z.array(z.string().max(60)).max(50).default([]),
});
export type OnlineBookingSettingsInput = z.infer<typeof onlineBookingSettingsSchema>;

/** What a client fills in on the public booking page. */
export const publicBookingSchema = z
  .object({
    branchId: z.string().uuid(),
    /** At the clinic, or a vet comes to the client (when the clinic offers home visits online). */
    location: z.enum(VISIT_LOCATIONS).default('CLINIC'),
    visitAddress: z.string().trim().max(500).optional().or(z.literal('')),
    /** Landmarks, gate or floor, parking. */
    visitDirections: z.string().trim().max(500).optional().or(z.literal('')),
    visitMapUrl: optMapUrl(),
    appointmentTypeId: z.string().uuid('Choose what the visit is for'),
    /** Other services chosen for the same visit (the first one chosen is appointmentTypeId). */
    extraTypeIds: z.array(z.string().uuid()).max(10).default([]),
    /** Empty = any vet who is free. */
    clinicianId: z.string().uuid().optional().or(z.literal('')),
    startsAt: z.coerce.date({ invalid_type_error: 'Choose a time' }),
    ownerName: z.string().trim().min(2, 'Enter your name').max(120),
    mobilePhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,24}$/, 'Enter your mobile number, e.g. 0300 1234567'),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Email looks incomplete — e.g. name@gmail.com').max(254)]).optional(),
    /** A pet already registered to this client (shown after they gave their name and mobile); else a new one below. */
    patientId: z.string().uuid().optional().or(z.literal('')),
    petName: z.string().trim().max(80).optional().or(z.literal('')),
    speciesId: z.string().uuid('Choose the kind of animal').optional().or(z.literal('')),
    reason: z.string().trim().max(500).optional().or(z.literal('')),
    /** Hidden field: people leave it empty, spam robots fill it in. */
    website: z.string().max(0, 'Please leave this empty').optional().or(z.literal('')),
  })
  .refine((v) => v.location !== 'HOME' || (v.visitAddress ?? '').trim().length >= 5, {
    path: ['visitAddress'],
    message: 'Enter the full address the vet should come to',
  })
  .refine((v) => !!v.patientId || !!v.petName?.trim(), { path: ['petName'], message: 'Enter your pet’s name' })
  .refine((v) => !!v.patientId || !!v.speciesId, { path: ['speciesId'], message: 'Choose the kind of animal' });
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

/** "Is this you?" on the booking page: the pets are shown only when the name and the mobile number both match. */
export const publicLookupSchema = z.object({
  ownerName: z.string().trim().min(2, 'Enter your name').max(120),
  mobilePhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,24}$/, 'Enter your mobile number, e.g. 0300 1234567'),
});

export const publicRescheduleSchema = z.object({
  startsAt: z.coerce.date({ invalid_type_error: 'Choose a time' }),
  clinicianId: z.string().uuid().optional().or(z.literal('')),
});

export const publicCancelSchema = z.object({
  reason: z.string().trim().max(300).optional().or(z.literal('')),
});

/** Builds the iCalendar (.ics) text for "Add to my calendar". */
export function bookingIcs(a: { uid: string; startsAt: string; endsAt: string; title: string; location?: string | null; description?: string | null }) {
  const stamp = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NextCore VCMS//Online booking//EN',
    'BEGIN:VEVENT',
    `UID:${a.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(a.startsAt)}`,
    `DTEND:${stamp(a.endsAt)}`,
    `SUMMARY:${esc(a.title)}`,
    a.location ? `LOCATION:${esc(a.location)}` : '',
    a.description ? `DESCRIPTION:${esc(a.description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}
