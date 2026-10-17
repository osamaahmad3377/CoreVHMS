import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COUNTRIES, DEFAULT_PRODUCT_CATEGORIES, SYSTEM_ROLE_TEMPLATES } from '@vcms/shared';
import { DEFAULT_SPECIES } from '../catalog/default-species';

export interface BootstrapInput {
  name: string;
  country: 'PK' | 'AU';
  branchName: string;
  ownerUserId: string;
}

/**
 * Creates a fully usable organization: main branch, system roles, owner membership and starter catalogues.
 * Runs on the unscoped client inside the caller's transaction (no tenant context exists yet).
 */
@Injectable()
export class OrgBootstrapService {
  async create(tx: Prisma.TransactionClient, input: BootstrapInput) {
    const country = COUNTRIES.find((c) => c.code === input.country)!;
    const org = await tx.organization.create({
      data: {
        name: input.name,
        country: country.code,
        currency: country.currency,
        defaultTimezone: country.timezone,
        dateFormat: 'dd/MM/yyyy',
      },
    });
    const branch = await tx.branch.create({
      data: { organizationId: org.id, name: input.branchName, code: 'MAIN', timezone: country.timezone },
    });

    const roleIds: Record<string, string> = {};
    for (const t of SYSTEM_ROLE_TEMPLATES) {
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          key: t.key,
          name: t.name,
          description: t.description,
          isSystem: true,
          permissions: { create: t.permissions.map((permission) => ({ permission })) },
        },
      });
      roleIds[t.key] = role.id;
    }

    const membership = await tx.membership.create({
      data: {
        organizationId: org.id,
        userId: input.ownerUserId,
        status: 'ACTIVE',
        isClinician: false,
        jobTitle: 'Owner',
        joinedAt: new Date(),
        roles: { create: [{ roleId: roleIds.owner }] },
        branches: { create: [{ branchId: branch.id }] },
      },
    });

    for (const s of DEFAULT_SPECIES) {
      const species = await tx.species.create({
        data: { organizationId: org.id, name: s.name, category: s.category },
      });
      if (s.breeds.length) {
        await tx.breed.createMany({
          data: s.breeds.map((name) => ({ organizationId: org.id, speciesId: species.id, name })),
        });
      }
    }

    // Starter shop categories (food, grooming, accessories…); the clinic can rename, add or hide them.
    await tx.productCategory.createMany({ data: DEFAULT_PRODUCT_CATEGORIES.map((c) => ({ ...c, organizationId: org.id })) });

    return { org, branch, membership, roleIds };
  }

  /**
   * Starter setup for a clinic that registers itself, so day one works without a settings tour:
   * one cash drawer per branch, and a starter price list (consultation, follow-up, vaccination, deworming)
   * with matching appointment types. Prices are 0 placeholders the owner must set ("Check your price list"
   * in the setup checklist); nothing clinical is assumed. Each part is skipped if the clinic already has it.
   *
   * No stock location is created here: an empty store switches stock checks on and would block every
   * dispense and sale until stock is entered. The checklist creates "Main store" when the owner starts
   * "Enter the stock you have now" (OnboardingService.ensureStoreRoom).
   */
  async starterSetup(tx: Prisma.TransactionClient, organizationId: string) {
    const branches = await tx.branch.findMany({ where: { organizationId, isActive: true }, select: { id: true } });
    for (const b of branches) {
      if (!(await tx.cashRegister.count({ where: { branchId: b.id } }))) {
        await tx.cashRegister.create({ data: { organizationId, branchId: b.id, name: STARTER_CASH_DRAWER } });
      }
    }

    if (!(await tx.service.count({ where: { organizationId } }))) {
      const hasTypes = (await tx.appointmentType.count({ where: { organizationId } })) > 0;
      for (const s of STARTER_SERVICES) {
        const service = await tx.service.create({ data: { organizationId, code: s.code, name: s.name, category: s.category, priceMinor: 0 } });
        if (!hasTypes) {
          await tx.appointmentType.create({
            data: { organizationId, name: s.name, category: s.appointmentCategory, durationMinutes: s.durationMinutes, color: s.color, serviceId: service.id },
          });
        }
      }
    }
  }
}

export const STARTER_CASH_DRAWER = 'Reception';

/** Starter price list for a new clinic: names only, price 0 until the clinic sets its own. Durations are booking defaults. */
export const STARTER_SERVICES: {
  code: string;
  name: string;
  category: 'CONSULTATION' | 'VACCINATION' | 'PROCEDURE';
  appointmentCategory: 'CONSULTATION' | 'FOLLOW_UP' | 'VACCINATION' | 'OTHER';
  durationMinutes: number;
  color: string;
}[] = [
  { code: 'CONSULT', name: 'Consultation', category: 'CONSULTATION', appointmentCategory: 'CONSULTATION', durationMinutes: 20, color: '#0d7a70' },
  { code: 'FOLLOWUP', name: 'Follow-up', category: 'CONSULTATION', appointmentCategory: 'FOLLOW_UP', durationMinutes: 15, color: '#7c3aed' },
  { code: 'VACCINATION', name: 'Vaccination', category: 'VACCINATION', appointmentCategory: 'VACCINATION', durationMinutes: 15, color: '#2563eb' },
  { code: 'DEWORMING', name: 'Deworming', category: 'PROCEDURE', appointmentCategory: 'OTHER', durationMinutes: 15, color: '#65a30d' },
];
