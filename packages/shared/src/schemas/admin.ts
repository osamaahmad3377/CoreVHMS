import { z } from 'zod';
import { optEmail, optPhone, optText, reqText } from './common';

export const organizationUpdateSchema = z.object({
  name: reqText(160).optional(),
  legalName: optText(200),
  registrationNumber: optText(80),
  taxNumber: optText(80),
  email: optEmail(),
  phone: optPhone(),
  website: optText(200),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(100),
  state: optText(100),
  postcode: optText(20),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']).optional(),
  weightUnit: z.enum(['kg', 'lb']).optional(),
  temperatureUnit: z.enum(['C', 'F']).optional(),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export const branchSchema = z.object({
  name: reqText(160),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, '2–10 letters or digits'),
  timezone: reqText(64),
  email: optEmail(),
  phone: optPhone(),
  addressLine1: optText(200),
  addressLine2: optText(200),
  city: optText(100),
  state: optText(100),
  postcode: optText(20),
  isActive: z.boolean().optional(),
});
export type BranchInput = z.infer<typeof branchSchema>;
export const branchUpdateSchema = branchSchema.partial();

export const roleSchema = z.object({
  name: reqText(80),
  description: optText(300),
  permissions: z.array(z.string()).max(200),
});
export type RoleInput = z.infer<typeof roleSchema>;
export const roleUpdateSchema = roleSchema.partial();

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  roleIds: z.array(z.string().uuid()).min(1, 'Select at least one role'),
  branchIds: z.array(z.string().uuid()).min(1, 'Select at least one branch'),
  jobTitle: optText(120),
  isClinician: z.boolean().default(false),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateMembershipSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1).optional(),
  branchIds: z.array(z.string().uuid()).min(1).optional(),
  jobTitle: optText(120),
  isClinician: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  professionalRegistration: optText(80),
});
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(400).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
