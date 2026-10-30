import { z } from 'zod';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_SOURCES, LEAVE_TYPES, RESOURCE_TYPES, TRIAGE_PRIORITIES, VISIT_LOCATIONS } from '../enums';
import { optDate, optInt, optText, optUuid, reqText } from './common';

export const appointmentTypeSchema = z.object({
  name: reqText(80),
  category: z.enum(APPOINTMENT_CATEGORIES).default('CONSULTATION'),
  durationMinutes: z.coerce.number().int().min(5).max(600),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0d7a70'),
  priceMinor: optInt(0, 1_000_000_000),
  /** Billable service charged when a consultation of this type is completed. */
  serviceId: optUuid(),
  requiresClinician: z.boolean().default(true),
  allowOnlineBooking: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type AppointmentTypeInput = z.infer<typeof appointmentTypeSchema>;

export const resourceSchema = z.object({
  branchId: z.string().uuid(),
  name: reqText(80),
  type: z.enum(RESOURCE_TYPES).default('ROOM'),
  isActive: z.boolean().default(true),
});

const minute = z.coerce.number().int().min(0).max(1440);
export const workingHoursSchema = z.object({
  branchId: z.string().uuid(),
  slots: z
    .array(z.object({ dayOfWeek: z.coerce.number().int().min(0).max(6), startMinute: minute, endMinute: minute }))
    .max(50)
    .superRefine((slots, ctx) => {
      slots.forEach((s, i) => {
        if (s.endMinute <= s.startMinute) ctx.addIssue({ code: 'custom', path: [i, 'endMinute'], message: 'End must be after start' });
      });
      for (let d = 0; d < 7; d++) {
        const day = slots.filter((s) => s.dayOfWeek === d).sort((a, b) => a.startMinute - b.startMinute);
        for (let i = 1; i < day.length; i++) {
          if (day[i].startMinute < day[i - 1].endMinute) ctx.addIssue({ code: 'custom', path: [], message: 'Shifts on the same day overlap' });
        }
      }
    }),
});
export type WorkingHoursInput = z.infer<typeof workingHoursSchema>;

export const leaveSchema = z
  .object({
    membershipId: z.string().uuid(),
    type: z.enum(LEAVE_TYPES).default('ANNUAL'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: optText(300),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ['endsAt'], message: 'End must be after start' });

/** A map pin link shared by the client: https only, so it can be opened safely. '' clears. */
export const optMapUrl = () =>
  z
    .union([z.literal(''), z.string().trim().max(500).url('Paste the full map link, starting with https://').refine((v) => /^https:\/\//i.test(v), 'Paste the full map link, starting with https://')])
    .nullish()
    .transform((v) => (v === '' ? null : v));

/** Home visit details on a booking. Travel time is blocked on the vet's calendar before the visit. */
const homeVisitFields = {
  location: z.enum(VISIT_LOCATIONS).default('CLINIC'),
  visitAddress: optText(500),
  visitDirections: optText(500),
  visitMapUrl: optMapUrl(),
  travelMinutes: optInt(0, 240),
};

const needsAddress = (v: { location?: string; visitAddress?: string | null }) => v.location !== 'HOME' || !!v.visitAddress;
const addressIssue = { path: ['visitAddress'], message: 'Enter the address the vet should go to' };

export const createAppointmentSchema = z
  .object({
    ...homeVisitFields,
    branchId: z.string().uuid(),
    clientId: z.string().uuid(),
    patientId: optUuid(),
    appointmentTypeId: z.string().uuid(),
    clinicianId: optUuid(),
    resourceIds: z.array(z.string().uuid()).max(5).default([]),
    startsAt: z.coerce.date(),
    durationMinutes: z.coerce.number().int().min(5).max(720).optional(),
    source: z.enum(APPOINTMENT_SOURCES).default('RECEPTION'),
    reason: optText(500),
    notes: optText(2000),
    allowOverbook: z.boolean().default(false),
    allowOutsideHours: z.boolean().default(false),
    followUpOfId: optUuid(),
    repeat: z
      .object({ everyWeeks: z.coerce.number().int().min(1).max(52), occurrences: z.coerce.number().int().min(2).max(52) })
      .optional(),
  })
  .refine(needsAddress, addressIssue);
/** `location` may be left out by code that books clinic visits (it defaults to the clinic). */
export type CreateAppointmentInput = Omit<z.infer<typeof createAppointmentSchema>, 'location'> & { location?: z.infer<typeof createAppointmentSchema>['location'] };

export const rescheduleAppointmentSchema = z.object({
  location: z.enum(VISIT_LOCATIONS).optional(),
  visitAddress: optText(500),
  visitDirections: optText(500),
  visitMapUrl: optMapUrl(),
  travelMinutes: optInt(0, 240),
  startsAt: z.coerce.date().optional(),
  durationMinutes: z.coerce.number().int().min(5).max(720).optional(),
  clinicianId: optUuid(),
  resourceIds: z.array(z.string().uuid()).max(5).optional(),
  appointmentTypeId: z.string().uuid().optional(),
  patientId: optUuid(),
  reason: optText(500),
  notes: optText(2000),
  allowOverbook: z.boolean().default(false),
  allowOutsideHours: z.boolean().default(false),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const appointmentStatusActionSchema = z.object({
  action: z.enum(['confirm', 'check-in', 'start', 'complete', 'cancel', 'no-show', 'revert']),
  reason: optText(500),
});

export const appointmentListQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  branchId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  status: z.string().optional(),
});

export const availabilityQuery = z.object({
  branchId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointmentTypeId: z.string().uuid(),
  clinicianId: z.string().uuid().optional(),
  /** Home visit: the vet must also be free for this long before the start (travel). */
  travelMinutes: z.coerce.number().int().min(0).max(240).optional(),
});

// ── Home visits ──

export const homeVisitSettingsSchema = z.object({
  /** Service from the price list charged once per home visit. */
  calloutServiceId: optUuid(),
  /** Service whose price is charged per km travelled. */
  perKmServiceId: optUuid(),
  travelMinutes: z.coerce.number().int().min(0).max(240),
});
export type HomeVisitSettingsInput = z.infer<typeof homeVisitSettingsSchema>;

export const homeVisitDayQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
});

export const homeVisitOnTheWaySchema = z.object({
  /** Send the client a message that the vet is on the way. */
  notifyClient: z.boolean().default(true),
});

const km = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0, 'Enter 0 or more').max(2000, 'That is more than 2000 km').nullish()) as z.ZodType<number | null | undefined, z.ZodTypeDef, unknown>;

export const homeVisitArriveSchema = z.object({
  /** Distance travelled to the client (km); can also be recorded later. */
  distanceKm: km,
});

export const homeVisitDistanceSchema = z.object({
  distanceKm: z.coerce.number().min(0, 'Enter 0 or more').max(2000, 'That is more than 2000 km'),
});

export const walkInSchema = z.object({
  branchId: z.string().uuid(),
  clientId: z.string().uuid(),
  patientId: z.string().uuid(),
  appointmentTypeId: z.string().uuid(),
  clinicianId: optUuid(),
  reason: optText(500),
  priority: z.enum(TRIAGE_PRIORITIES).optional(),
});

export const waitlistSchema = z.object({
  branchId: z.string().uuid(),
  clientId: z.string().uuid(),
  patientId: optUuid(),
  appointmentTypeId: optUuid(),
  preferredClinicianId: optUuid(),
  earliestDate: optDate(),
  latestDate: optDate(),
  notes: optText(500),
});

export const triageSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: optUuid(),
  priority: z.enum(TRIAGE_PRIORITIES),
  presentingComplaint: reqText(500),
  temperatureC: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(25).max(46).nullish()),
  heartRate: optInt(0, 400),
  respiratoryRate: optInt(0, 200),
  mucousMembranes: optText(40),
  capillaryRefillSec: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(10).nullish()),
  painScore: optInt(0, 10),
  mentation: optText(40),
  notes: optText(1000),
});
export type TriageInput = z.infer<typeof triageSchema>;
