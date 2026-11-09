import type { Branding } from '@vcms/shared';

/** What the public booking page knows about the clinic. */
export interface BookingInfo {
  clinic: { name: string; phone: string | null; country: string; currency: string; branding: Branding };
  settings: { daysAhead: number; minNoticeHours: number; cancelNoticeHours: number; allowNewClients: boolean; autoConfirm: boolean; allowHomeVisits: boolean; welcomeMessage: string | null };
  branches: { id: string; name: string; address: string | null; phone: string | null; timezone: string; vetCount: number }[];
  appointmentTypes: { id: string; name: string; durationMinutes: number; category: string; color: string; categoryName: string; categorySort: number }[];
  clinicians: { id: string; name: string; jobTitle: string | null; branchIds: string[] }[];
  species: { id: string; name: string; category: string }[];
}

export interface BookingSummary {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  petName: string | null;
  ownerName: string;
  service: string;
  appointmentTypeId: string;
  extraTypeIds?: string[];
  location?: 'CLINIC' | 'HOME';
  visitAddress?: string | null;
  vet: string | null;
  clinicianId: string | null;
  branch: { id: string; name: string; address: string | null; phone: string | null; timezone: string };
}

export interface FreeTime {
  startsAt: string;
  clinicianIds: string[];
}
