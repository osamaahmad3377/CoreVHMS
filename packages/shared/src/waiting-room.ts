import { z } from 'zod';

/** Calling a waiting patient to a room. */
export const callPatientSchema = z.object({ room: z.string().trim().max(60).optional().or(z.literal('')) });

/** Settings → Waiting room, per branch. */
export const waitingRoomSettingsSchema = z.object({
  displayEnabled: z.boolean(),
  kioskEnabled: z.boolean(),
  showPetNames: z.boolean(),
  kioskWalkIns: z.boolean(),
  announce: z.boolean(),
  message: z.string().trim().max(200).optional().or(z.literal('')),
});

const mobile = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,24}$/, 'Enter your mobile number, e.g. 0300 1234567');

/** The check-in tablet: find today's visits by mobile number, check one in, or check in as a walk-in. */
export const kioskLookupSchema = z.object({ mobilePhone: mobile });
export const kioskCheckInSchema = z.object({ mobilePhone: mobile, appointmentId: z.string().uuid() });
export const kioskWalkInSchema = z.object({ mobilePhone: mobile, patientId: z.string().uuid(), appointmentTypeId: z.string().uuid() });

/** "Token 12, please go to Room 2." — what the waiting-room screen reads out. */
export function callAnnouncement(token: number | string, room?: string | null) {
  return room ? `Token number ${token}, please go to ${room}.` : `Token number ${token}, please come in.`;
}
