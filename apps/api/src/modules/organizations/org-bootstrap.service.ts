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
}
