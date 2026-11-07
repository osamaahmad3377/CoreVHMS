import { Prisma } from '@prisma/client';
import { DENTAL_PROCEDURES, STARTER_SECTIONS, STARTER_SECTION_LABELS, type StarterPlanSection, type StarterSection } from '@vcms/shared';
import { categoryForKind, categoryNamed } from '../scheduling/appointment-categories';
import {
  STARTER_APPOINTMENT_TYPES,
  STARTER_BOARDING_UNITS,
  STARTER_CASH_DRAWER,
  STARTER_DENTAL_PRICES,
  STARTER_HOME_VISIT,
  STARTER_LAB_TESTS,
  STARTER_PRICE_LIST,
  STARTER_RESOURCES,
  STARTER_STORE_ROOMS,
  STARTER_SUPPLIER,
  STARTER_WARDS,
} from './starter-catalogue';

/**
 * The starter set-up (see starter-catalogue.ts), added item by item: only what the clinic does not have yet.
 * A new clinic gets all of it; an existing clinic (super admin → “Add starter set-up”) sees a preview first and
 * chooses the parts. Anything the clinic already has — matched by code or by name, ignoring case — is left alone,
 * so running it twice adds nothing the second time. Runs on the unscoped client inside the caller's transaction,
 * so every query names the organization.
 */

type Tx = Prisma.TransactionClient;
const norm = (s: string) => s.trim().toLowerCase();
const dentalLabel = (code: string) => DENTAL_PROCEDURES.find((p) => p.code === code)?.label ?? code;

/** What is missing, read from the clinic's current data. */
async function missing(tx: Tx, organizationId: string) {
  const branches = await tx.branch.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  const [services, types, prices, tests, suppliers, org] = await Promise.all([
    tx.service.findMany({ where: { organizationId }, select: { code: true, name: true } }),
    tx.appointmentType.findMany({ where: { organizationId }, select: { name: true } }),
    tx.dentalProcedurePrice.findMany({ where: { organizationId }, select: { code: true } }),
    tx.labTest.findMany({ where: { organizationId }, select: { code: true, name: true } }),
    tx.supplier.findMany({ where: { organizationId }, select: { name: true } }),
    tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { homeVisitCalloutServiceId: true, homeVisitPerKmServiceId: true } }),
  ]);
  const has = (list: { name: string; code?: string }[], item: { name: string; code?: string }) =>
    list.some((x) => norm(x.name) === norm(item.name) || (!!item.code && !!x.code && norm(x.code) === norm(item.code)));

  const perBranch = await Promise.all(
    branches.map(async (b) => {
      const [resources, wards, units, stores, drawers] = await Promise.all([
        tx.resource.findMany({ where: { branchId: b.id }, select: { name: true } }),
        tx.ward.findMany({ where: { branchId: b.id }, select: { name: true } }),
        tx.boardingUnit.findMany({ where: { branchId: b.id }, select: { name: true } }),
        tx.stockLocation.findMany({ where: { branchId: b.id }, select: { name: true, isDefault: true } }),
        tx.cashRegister.count({ where: { branchId: b.id } }),
      ]);
      return {
        branch: b,
        cashDrawer: drawers === 0,
        resources: STARTER_RESOURCES.filter((r) => !has(resources, r)),
        wards: STARTER_WARDS.filter((w) => !has(wards, w)),
        boarding: STARTER_BOARDING_UNITS.filter((u) => !has(units, u)),
        storeRooms: STARTER_STORE_ROOMS.filter((l) => !has(stores, l)),
        hasDefaultStore: stores.some((l) => l.isDefault),
      };
    }),
  );

  return {
    branches,
    services: STARTER_PRICE_LIST.filter((s) => !has(services, s)),
    appointmentTypes: STARTER_APPOINTMENT_TYPES.filter((t) => !has(types, t)),
    homeVisits: !org.homeVisitCalloutServiceId && !org.homeVisitPerKmServiceId,
    dentalPrices: STARTER_DENTAL_PRICES.filter((p) => !prices.some((x) => x.code === p.code)),
    labTests: STARTER_LAB_TESTS.filter((t) => !has(tests, t)),
    supplier: !has(suppliers, STARTER_SUPPLIER),
    perBranch,
  };
}

/** Preview: for each part, the names of what would be added. */
export async function planStarter(tx: Tx, organizationId: string): Promise<StarterPlanSection[]> {
  const m = await missing(tx, organizationId);
  const several = m.branches.length > 1;
  const at = (branch: { name: string }, name: string) => (several ? `${branch.name}: ${name}` : name);
  const items: Record<StarterSection, string[]> = {
    services: m.services.map((s) => s.name),
    homeVisits: m.homeVisits ? ['Call-out fee and price per km'] : [],
    appointmentTypes: m.appointmentTypes.map((t) => t.name),
    dentalPrices: m.dentalPrices.map((p) => dentalLabel(p.code)),
    labTests: m.labTests.map((t) => t.name),
    supplier: m.supplier ? [STARTER_SUPPLIER.name] : [],
    cashDrawer: m.perBranch.filter((b) => b.cashDrawer).map((b) => at(b.branch, STARTER_CASH_DRAWER)),
    resources: m.perBranch.flatMap((b) => b.resources.map((r) => at(b.branch, r.name))),
    wards: m.perBranch.flatMap((b) => b.wards.map((w) => at(b.branch, `${w.name} (${w.cages.length} cages)`))),
    boarding: m.perBranch.flatMap((b) => b.boarding.map((u) => at(b.branch, u.name))),
    storeRooms: m.perBranch.flatMap((b) => b.storeRooms.map((l) => at(b.branch, l.name))),
  };
  return STARTER_SECTIONS.map((key) => ({
    key,
    label: STARTER_SECTION_LABELS[key],
    items: items[key],
    note: items[key].length ? null : key === 'homeVisits' ? 'Already set' : 'Nothing missing',
  }));
}

/** Adds what is missing in the chosen parts (all parts for a new clinic). Returns how many items each part added. */
export async function applyStarter(tx: Tx, organizationId: string, sections: readonly StarterSection[] = STARTER_SECTIONS): Promise<Record<StarterSection, number>> {
  const on = new Set(sections);
  const m = await missing(tx, organizationId);
  const added = Object.fromEntries(STARTER_SECTIONS.map((k) => [k, 0])) as Record<StarterSection, number>;

  // Price list first (everything at 0: "Check your price list" asks the owner to set real prices) — the parts below
  // link to it.
  if (on.has('services') && m.services.length) {
    await tx.service.createMany({ data: m.services.map((x) => ({ organizationId, code: x.code, name: x.name, category: x.category, priceMinor: 0 })) });
    added.services = m.services.length;
  }
  // A starter item links to the clinic's service with the starter code, else to one with the starter name.
  const services = await tx.service.findMany({ where: { organizationId }, select: { id: true, code: true, name: true } });
  const svc = (code: string | null) => {
    if (!code) return null;
    const name = STARTER_PRICE_LIST.find((s) => s.code === code)?.name;
    return (services.find((s) => s.code === code) ?? services.find((s) => !!name && norm(s.name) === norm(name)))?.id ?? null;
  };

  if (on.has('homeVisits') && m.homeVisits) {
    const callout = svc(STARTER_HOME_VISIT.calloutCode);
    const perKm = svc(STARTER_HOME_VISIT.perKmCode);
    if (callout || perKm) {
      await tx.organization.update({ where: { id: organizationId }, data: { homeVisitCalloutServiceId: callout, homeVisitPerKmServiceId: perKm } });
      added.homeVisits = 1;
    }
  }

  if (on.has('appointmentTypes')) {
    for (const t of m.appointmentTypes) {
      await tx.appointmentType.create({
        data: { organizationId, name: t.name, category: t.kind, categoryId: t.category ? await categoryNamed(tx, organizationId, t.category, t.kind) : await categoryForKind(tx, organizationId, t.kind), durationMinutes: t.durationMinutes, color: t.color, serviceId: svc(t.serviceCode), allowOnlineBooking: t.allowOnlineBooking ?? false },
      });
      added.appointmentTypes++;
    }
  }

  if (on.has('dentalPrices')) {
    const rows = m.dentalPrices.map((d) => ({ organizationId, code: d.code, serviceId: svc(d.serviceCode) })).filter((r): r is { organizationId: string; code: string; serviceId: string } => !!r.serviceId);
    if (rows.length) await tx.dentalProcedurePrice.createMany({ data: rows });
    added.dentalPrices = rows.length;
  }

  if (on.has('labTests')) {
    for (const t of m.labTests) {
      const test = await tx.labTest.create({ data: { organizationId, code: t.code, name: t.name, category: t.category, sampleType: t.sampleType, modality: t.modality ?? null, priceMinor: 0 } });
      if (t.analytes.length) {
        await tx.labAnalyte.createMany({
          data: t.analytes.map((a, i) => ({ organizationId, testId: test.id, code: a.code, name: a.name, unit: a.unit || null, resultType: a.resultType ?? 'NUMERIC', options: a.options ?? [], decimals: a.decimals ?? 1, sortOrder: i })),
        });
      }
      added.labTests++;
    }
  }

  if (on.has('supplier') && m.supplier) {
    await tx.supplier.create({ data: { organizationId, ...STARTER_SUPPLIER } });
    added.supplier = 1;
  }

  for (const b of m.perBranch) {
    const branchId = b.branch.id;
    if (on.has('cashDrawer') && b.cashDrawer) {
      await tx.cashRegister.create({ data: { organizationId, branchId, name: STARTER_CASH_DRAWER } });
      added.cashDrawer++;
    }
    if (on.has('resources') && b.resources.length) {
      await tx.resource.createMany({ data: b.resources.map((r) => ({ organizationId, branchId, name: r.name, type: r.type })) });
      added.resources += b.resources.length;
    }
    if (on.has('wards')) {
      const start = await tx.ward.count({ where: { branchId } });
      for (const [i, w] of b.wards.entries()) {
        const ward = await tx.ward.create({ data: { organizationId, branchId, name: w.name, type: w.type, dailyServiceId: svc(w.dailyServiceCode), sortOrder: start + i } });
        await tx.cage.createMany({ data: w.cages.map((name, j) => ({ organizationId, wardId: ward.id, name, sortOrder: j })) });
        added.wards++;
      }
    }
    if (on.has('boarding') && b.boarding.length) {
      const start = await tx.boardingUnit.count({ where: { branchId } });
      await tx.boardingUnit.createMany({ data: b.boarding.map((u, i) => ({ organizationId, branchId, name: u.name, type: u.type, nightlyServiceId: svc(u.nightlyServiceCode), sortOrder: start + i })) });
      added.boarding += b.boarding.length;
    }
    if (on.has('storeRooms') && b.storeRooms.length) {
      // Only becomes the default store if the branch has none; stock checks start once stock is entered.
      await tx.stockLocation.createMany({ data: b.storeRooms.map((l) => ({ organizationId, branchId, name: l.name, type: l.type, isDefault: l.isDefault && !b.hasDefaultStore })) });
      added.storeRooms += b.storeRooms.length;
    }
  }
  return added;
}
