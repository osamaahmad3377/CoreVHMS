import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COUNTRIES, DEFAULT_PRODUCT_CATEGORIES, SYSTEM_ROLE_TEMPLATES } from '@vcms/shared';
import { DEFAULT_SPECIES } from '../catalog/default-species';
import { DEFAULT_APPOINTMENT_CATEGORIES, categoryForKind } from '../scheduling/appointment-categories';
import { ensureSystemAccount } from '../users/system-account';
import {
  STARTER_APPOINTMENT_TYPES,
  STARTER_BOARDING_UNITS,
  STARTER_DENTAL_PRICES,
  STARTER_HOME_VISIT,
  STARTER_LAB_TESTS,
  STARTER_PRICE_LIST,
  STARTER_RESOURCES,
  STARTER_STORE_ROOMS,
  STARTER_SUPPLIER,
  STARTER_WARDS,
} from './starter-catalogue';

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
   * Nothing clinical is assumed (see starter-catalogue.ts). Each part is skipped if the clinic already has it, so
   * running it again after a partial failure only fills the gaps.
   */
  async starterSetup(tx: Prisma.TransactionClient, organizationId: string) {
    const branches = await tx.branch.findMany({ where: { organizationId, isActive: true }, select: { id: true } });
    for (const b of branches) {
      if (!(await tx.cashRegister.count({ where: { branchId: b.id } }))) {
        await tx.cashRegister.create({ data: { organizationId, branchId: b.id, name: STARTER_CASH_DRAWER } });
      }
    }

    // Price list: everything at 0 ("Check your price list" asks the owner to set real prices).
    if (!(await tx.service.count({ where: { organizationId } }))) {
      await tx.service.createMany({ data: STARTER_PRICE_LIST.map((x) => ({ organizationId, code: x.code, name: x.name, category: x.category, priceMinor: 0 })) });
    }
    const services = await tx.service.findMany({ where: { organizationId, code: { in: STARTER_PRICE_LIST.map((x) => x.code) } }, select: { id: true, code: true } });
    const svc = (code: string | null) => (code ? (services.find((x) => x.code === code)?.id ?? null) : null);

    if (!(await tx.appointmentType.count({ where: { organizationId } }))) {
      for (const t of STARTER_APPOINTMENT_TYPES) {
        await tx.appointmentType.create({
          data: { organizationId, name: t.name, category: t.kind, categoryId: await categoryForKind(tx, organizationId, t.kind), durationMinutes: t.durationMinutes, color: t.color, serviceId: svc(t.serviceCode), allowOnlineBooking: t.allowOnlineBooking ?? false },
        });
      }
    }

    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { homeVisitCalloutServiceId: true, homeVisitPerKmServiceId: true } });
    if (!org.homeVisitCalloutServiceId && !org.homeVisitPerKmServiceId) {
      await tx.organization.update({ where: { id: organizationId }, data: { homeVisitCalloutServiceId: svc(STARTER_HOME_VISIT.calloutCode), homeVisitPerKmServiceId: svc(STARTER_HOME_VISIT.perKmCode) } });
    }

    if (!(await tx.dentalProcedurePrice.count({ where: { organizationId } }))) {
      const rows = STARTER_DENTAL_PRICES.map((d) => ({ organizationId, code: d.code, serviceId: svc(d.serviceCode) })).filter((r): r is { organizationId: string; code: string; serviceId: string } => !!r.serviceId);
      if (rows.length) await tx.dentalProcedurePrice.createMany({ data: rows });
    }

    if (!(await tx.labTest.count({ where: { organizationId } }))) {
      for (const t of STARTER_LAB_TESTS) {
        const test = await tx.labTest.create({ data: { organizationId, code: t.code, name: t.name, category: t.category, sampleType: t.sampleType, modality: t.modality ?? null, priceMinor: 0 } });
        if (t.analytes.length) {
          await tx.labAnalyte.createMany({
            data: t.analytes.map((a, i) => ({ organizationId, testId: test.id, code: a.code, name: a.name, unit: a.unit || null, resultType: a.resultType ?? 'NUMERIC', options: a.options ?? [], decimals: a.decimals ?? 1, sortOrder: i })),
          });
        }
      }
    }

    if (!(await tx.supplier.count({ where: { organizationId } }))) {
      await tx.supplier.create({ data: { organizationId, ...STARTER_SUPPLIER } });
    }

    for (const b of branches) {
      if (!(await tx.resource.count({ where: { branchId: b.id } }))) {
        await tx.resource.createMany({ data: STARTER_RESOURCES.map((r) => ({ organizationId, branchId: b.id, name: r.name, type: r.type })) });
      }
      if (!(await tx.ward.count({ where: { branchId: b.id } }))) {
        for (const [i, w] of STARTER_WARDS.entries()) {
          const ward = await tx.ward.create({ data: { organizationId, branchId: b.id, name: w.name, type: w.type, dailyServiceId: svc(w.dailyServiceCode), sortOrder: i } });
          await tx.cage.createMany({ data: w.cages.map((name, j) => ({ organizationId, wardId: ward.id, name, sortOrder: j })) });
        }
      }
      if (!(await tx.boardingUnit.count({ where: { branchId: b.id } }))) {
        await tx.boardingUnit.createMany({ data: STARTER_BOARDING_UNITS.map((u, i) => ({ organizationId, branchId: b.id, name: u.name, type: u.type, nightlyServiceId: svc(u.nightlyServiceCode), sortOrder: i })) });
      }
      if (!(await tx.stockLocation.count({ where: { branchId: b.id } }))) {
        await tx.stockLocation.createMany({ data: STARTER_STORE_ROOMS.map((l) => ({ organizationId, branchId: b.id, name: l.name, type: l.type, isDefault: l.isDefault })) });
      }
    }
  }
}

export const STARTER_CASH_DRAWER = 'Reception';
