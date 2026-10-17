import { z } from 'zod';
import { CLIENT_TYPES, CONTACT_CHANNELS, CONTACT_ROLES } from '../enums';
import { optEmail, optPhone, optText, optUuid, paginationQuery, reqText } from './common';

export const addressSchema = z.object({
  label: optText(40),
  line1: reqText(200),
  line2: optText(200),
  city: optText(100),
  state: optText(100),
  postcode: optText(20),
  country: z.string().trim().length(2).toUpperCase().default('PK'),
  isPrimary: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

const clientBase = z.object({
  type: z.enum(CLIENT_TYPES).default('INDIVIDUAL'),
  title: optText(20),
  firstName: optText(80),
  lastName: optText(80),
  organizationName: optText(160),
  email: optEmail(),
  mobilePhone: optPhone('Enter a mobile number like 0300 1234567'),
  homePhone: optPhone(),
  workPhone: optPhone(),
  nationalId: optText(40),
  taxNumber: optText(40),
  preferredChannel: z.enum(CONTACT_CHANNELS).default('SMS'),
  preferredLanguage: optText(10),
  marketingConsent: z.boolean().default(false),
  remindersConsent: z.boolean().default(true),
  notes: optText(4000),
  referralSource: optText(120),
  primaryBranchId: optUuid(),
});

function refineClientName<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((v: any, ctx) => {
    const isOrg = v.type && !['INDIVIDUAL', 'FAMILY'].includes(v.type);
    if (isOrg && !v.organizationName && !v.lastName) {
      ctx.addIssue({ code: 'custom', path: ['organizationName'], message: 'Enter a farm or business name, or a contact surname' });
    }
    // One name is enough (many clients go by a single name); the surname is optional.
    if (!isOrg && v.type !== undefined && !v.firstName && !v.lastName) {
      ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'Enter the client’s name' });
    }
    if (v.email === null && v.mobilePhone === null && v.homePhone === null && v.workPhone === null) {
      // At least one way to reach the client is required on create; enforced by createClientSchema.
    }
  });
}

export const createClientSchema = refineClientName(
  clientBase.extend({
    address: addressSchema.optional(),
  }),
).superRefine((v: any, ctx) => {
  if (!v.email && !v.mobilePhone && !v.homePhone && !v.workPhone) {
    ctx.addIssue({ code: 'custom', path: ['mobilePhone'], message: 'Provide at least one phone number or email' });
  }
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = clientBase.partial();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientListQuery = paginationQuery.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  type: z.enum(CLIENT_TYPES).optional(),
  branchId: z.string().uuid().optional(),
  hasBalance: z.coerce.boolean().optional(),
});
export type ClientListQuery = z.infer<typeof clientListQuery>;

export const clientContactSchema = z.object({
  role: z.enum(CONTACT_ROLES),
  name: reqText(160),
  relationship: optText(80),
  email: optEmail(),
  phone: optPhone(),
  canAuthorizeTreatment: z.boolean().default(false),
  canCollectAnimal: z.boolean().default(false),
  notes: optText(1000),
});
export type ClientContactInput = z.infer<typeof clientContactSchema>;

export const clientNoteSchema = z.object({
  body: reqText(4000),
  isPinned: z.boolean().default(false),
  category: z.enum(['GENERAL', 'COMPLAINT', 'FINANCIAL', 'COMMUNICATION']).default('GENERAL'),
});

export const duplicateCheckSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  organizationName: z.string().optional(),
  email: z.string().optional(),
  mobilePhone: z.string().optional(),
  excludeId: z.string().uuid().optional(),
});

export const mergeClientsSchema = z.object({
  survivorId: z.string().uuid(),
  mergedId: z.string().uuid(),
  reason: reqText(500),
});

export const archiveSchema = z.object({
  reason: reqText(500),
});
