import { z } from 'zod';
import type { Branding } from '../branding';
import type { Entitlements, PlanFeature } from '../plans';

/** A clinic's subdomain: 3–30 lowercase letters, numbers and single hyphens, starting with a letter. */
export const clinicAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/, 'Use 3–30 lowercase letters, numbers or hyphens, starting with a letter');

export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: clinicAddressSchema,
  country: z.enum(['PK', 'AU']),
  branchName: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
  /** Temporary password shown once to the super admin, or an invitation email to the owner. */
  ownerAccess: z.enum(['TEMPORARY_PASSWORD', 'INVITATION']),
  /** The plan to start on; omit for a clinic without limits. */
  planId: z.string().uuid().nullish(),
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export type ClinicStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED';

export interface PlatformClinic {
  id: string;
  slug: string;
  name: string;
  /** Full web address, e.g. https://happypaws.nextcore.net.au */
  address: string;
  databaseName: string;
  status: ClinicStatus;
  country: string;
  ownerName: string;
  ownerEmail: string;
  ownerAccess: 'TEMPORARY_PASSWORD' | 'INVITATION';
  lastError: string | null;
  /** The clinic's plan and the super admin's exceptions for this clinic. */
  planId: string | null;
  planName: string | null;
  staffLimitOverride: number | null;
  branchLimitOverride: number | null;
  extraFeatures: PlanFeature[];
  removedFeatures: PlanFeature[];
  /** What the clinic may actually use (plan + exceptions). */
  entitlements: Entitlements;
  provisionedAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

/** How much a clinic is used (counts only; nothing clinical is read). */
export interface ClinicUsage {
  staff: number;
  activeStaff: number;
  /** Staff accounts counted against the plan: active and invited. */
  staffCounted: number;
  branches: number;
  clients: number;
  patients: number;
  appointmentsThisMonth: number;
  lastSignInAt: string | null;
}

export interface ClinicOverview {
  clinic: PlatformClinic;
  /** Null while the clinic is being set up, or if its database cannot be reached. */
  usage: ClinicUsage | null;
  events: { id: string; action: string; summary: string | null; actorName: string | null; createdAt: string }[];
}

/** Answer to "which part of the system is this address?" (public). */
export interface HostInfo {
  mode: 'single' | 'platform' | 'clinic' | 'root';
  /** On a clinic's address: its name, status and branding for the sign-in page, browser tab and icon. */
  clinic?: { name: string; status: ClinicStatus; branding?: Branding };
  baseDomain?: string;
}
