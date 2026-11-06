import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COUNTRIES, DEFAULT_PRODUCT_CATEGORIES, SYSTEM_ROLE_TEMPLATES, type StarterSection } from '@vcms/shared';
import { DEFAULT_SPECIES } from '../catalog/default-species';
import { DEFAULT_APPOINTMENT_CATEGORIES } from '../scheduling/appointment-categories';
import { ensureSystemAccount } from '../users/system-account';
import { applyStarter, planStarter } from './starter-setup';

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

    // NextCore's System account (support access, opened only from the super admin console).
    await ensureSystemAccount(tx, org.id);

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
    // Appointment categories, one per built-in kind; the clinic can rename, hide or add its own.
    await tx.appointmentTypeCategory.createMany({ data: DEFAULT_APPOINTMENT_CATEGORIES.map((c) => ({ ...c, organizationId: org.id })) });

    return { org, branch, membership, roleIds };
  }

  /**
   * Starter setup for every new clinic (registered by itself or set up by NextCore), so day one works without a
   * settings tour: a cash drawer per branch; a full price list (every price 0 until the clinic sets its own);
   * appointment types including grooming; home-visit fees; dental prices; the test catalogue; the "Local Purchase"
   * supplier; and, per branch, rooms and equipment, hospital wards with cages, boarding kennels and store rooms.
   * Nothing clinical is assumed (see starter-catalogue.ts). Only what the clinic does not have yet is added, so
   * running it again after a partial failure only fills the gaps.
   */
  async starterSetup(tx: Prisma.TransactionClient, organizationId: string) {
    return applyStarter(tx, organizationId);
  }

  /** For an existing clinic: what the starter set-up would add (nothing the clinic already has). */
  starterPlan(tx: Prisma.TransactionClient, organizationId: string) {
    return planStarter(tx, organizationId);
  }

  /** For an existing clinic: adds what is missing in the chosen parts only. */
  addStarter(tx: Prisma.TransactionClient, organizationId: string, sections: readonly StarterSection[]) {
    return applyStarter(tx, organizationId, sections);
  }
}

export { STARTER_CASH_DRAWER } from './starter-catalogue';
