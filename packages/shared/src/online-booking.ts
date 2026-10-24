import { z } from 'zod';

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
  welcomeMessage: z.string().trim().max(500).optional().or(z.literal('')),
  /** Appointment types clients can choose online. */
  appointmentTypeIds: z.array(z.string().uuid()).max(100).default([]),
});
export type OnlineBookingSettingsInput = z.infer<typeof onlineBookingSettingsSchema>;

/** What a client fills in on the public booking page. */
export const publicBookingSchema = z.object({
  branchId: z.string().uuid(),
  appointmentTypeId: z.string().uuid('Choose what the visit is for'),
  /** Empty = any vet who is free. */
  clinicianId: z.string().uuid().optional().or(z.literal('')),
  startsAt: z.coerce.date({ invalid_type_error: 'Choose a time' }),
  ownerName: z.string().trim().min(2, 'Enter your name').max(120),
  mobilePhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,24}$/, 'Enter your mobile number, e.g. 0300 1234567'),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Email looks incomplete — e.g. name@gmail.com').max(254)]).optional(),
  petName: z.string().trim().min(1, 'Enter your pet’s name').max(80),
  speciesId: z.string().uuid('Choose the kind of animal'),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
  /** Hidden field: people leave it empty, spam robots fill it in. */
  website: z.string().max(0, 'Please leave this empty').optional().or(z.literal('')),
});
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

export const publicRescheduleSchema = z.object({
  startsAt: z.coerce.date({ invalid_type_error: 'Choose a time' }),
  clinicianId: z.string().uuid().optional().or(z.literal('')),
});

export const publicCancelSchema = z.object({ reason: z.string().trim().max(300).optional().or(z.literal('')) });

/** Builds the iCalendar (.ics) text for "Add to my calendar". */
export function bookingIcs(a: { uid: string; startsAt: string; endsAt: string; title: string; location?: string | null; description?: string | null }) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
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
