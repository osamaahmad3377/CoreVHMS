import { z } from 'zod';
import type { Branding } from '../branding';
import type { OptionalModule } from '../modules';

export const passwordPolicy = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Include upper-case, lower-case letters and a number',
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().trim().min(6).max(16),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordPolicy,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(120),
  password: passwordPolicy,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordPolicy,
});

export const mfaEnableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
});

export const switchContextSchema = z.object({
  organizationId: z.string().uuid(),
  branchId: z.string().uuid().nullish(),
});

export const registerOrganizationSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  country: z.enum(['PK', 'AU']),
  branchName: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordPolicy,
});
export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
  /** Signed in with a temporary password: only changing the password (or signing out) is allowed. */
  mustChangePassword: boolean;
}

export interface SessionContext {
  user: SessionUser;
  organization: {
    id: string;
    name: string;
    country: string;
    currency: string;
    logoUrl: string | null;
    /** Optional areas this clinic offers (Settings → Services you offer); the rest are hidden, never deleted. */
    enabledModules: OptionalModule[];
    /** White label: name, logo, icon and colours (Settings → Branding, owner only). */
    branding: Branding;
  } | null;
  branch: { id: string; name: string; timezone: string } | null;
  branches: { id: string; name: string; timezone: string }[];
  organizations: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  permissions: string[];
  csrfToken: string;
  /** Optional product areas switched on for this installation. */
  features: { clientPortal: boolean };
  /** Signed in at the super admin address (multi-clinic hosting). */
  platform: boolean;
}
