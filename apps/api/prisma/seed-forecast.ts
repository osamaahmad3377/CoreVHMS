import { MovementType, Prisma, PrismaClient } from '@prisma/client';
import type { SeededOrg } from './seed-modules';

const DAY = 86_400_000;

/**
 * Eight weeks of demo use at two branches, so the stock forecast has something to show: products that run out
 * this week, orders to prepare, spare stock at the second branch, and a vaccine batch there that would expire unused.
 * History rows only (the shelf stock is the opening stock); runs once per organization.
 */
export async function seedForecast(prisma: PrismaClient, s: SeededOrg) {
  const orgId = s.org.id;
  if (s.branches.length < 2) return;
  if (await prisma.stockMovement.count({ where: { organizationId: orgId, referenceType: 'DemoHistory' } })) return;
  const pk = s.org.country === 'PK';
  const [main, second] = s.branches;
  const locOf = async (branchId: string) =>
    (await prisma.stockLocation.findFirst({ where: { organizationId: orgId, branchId, isDefault: true } })) ?? (await prisma.stockLocation.findFirst({ where: { organizationId: orgId, branchId } }));
  const mainLoc = await locOf(main.id);
  const secondLoc = await locOf(second.id);
  if (!mainLoc || !secondLoc) return;
  const supplier = await prisma.supplier.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } });
  const owner = await prisma.membership.findFirst({ where: { organizationId: orgId }, include: { user: true }, orderBy: { createdAt: 'asc' } });
  const products = new Map((await prisma.product.findMany({ where: { organizationId: orgId, sku: { not: null } } })).map((p) => [p.sku!, p]));
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();

  // Opening stock at the second branch.
  const secondStock: [string, number, number, number][] = [
    // sku, quantity, cost, expires in days
    ['AMX250', 150, pk ? 1500 : 40, 400],
    ['MLX15', 20, pk ? 1000 : 30, 300],
    ['VAC-RAB', 15, pk ? 60000 : 1800, 20], // the second branch will not use these in time
    ['FD-CAT85', 12, pk ? 15000 : 110, 500],
    ['GR-SHMP250', 14, pk ? 55000 : 950, 800],
  ];
  for (const [sku, qty, cost, exp] of secondStock) {
    const p = products.get(sku);
    if (!p) continue;
    const batch = await prisma.stockBatch.create({ data: { organizationId: orgId, productId: p.id, batchNumber: `${sku}-B2`, expiryDate: new Date(today + exp * DAY), unitCostMinor: cost, supplierId: supplier?.id ?? null } });
    await prisma.stockLevel.create({ data: { organizationId: orgId, productId: p.id, batchId: batch.id, locationId: secondLoc.id, quantity: qty } });
    await prisma.stockMovement.create({ data: { organizationId: orgId, branchId: second.id, productId: p.id, batchId: batch.id, locationId: secondLoc.id, type: 'RECEIPT', quantity: qty, balanceAfter: qty, unitCostMinor: cost, reason: 'Opening stock (demo)', createdByName: owner?.user.name ?? 'Demo seed', createdAt: new Date(Date.now() - 60 * DAY) } });
  }

  // Use per week at each branch: [sku, main branch, second branch, movement type].
  const use: [string, number, number, MovementType][] = [
    ['AMX250', 80, 5, 'DISPENSE'],
    ['MLX15', 45, 4, 'DISPENSE'],
    ['MTZ200', 22, 0, 'DISPENSE'],
    ['KET100', 9, 0, 'ADMINISTER'],
    ['VAC-RAB', 12, 1, 'ADMINISTER'],
    ['VAC-DHP', 10, 0, 'ADMINISTER'],
    ['FD-DOG3', 4, 0, 'SALE'],
    ['FD-CAT85', 48, 3, 'SALE'],
    ['TR-DENT7', 35, 0, 'SALE'],
    ['GR-SHMP250', 18, 1, 'SALE'],
    ['SP-JOINT60', 2, 0, 'SALE'],
  ];
  const rows: Prisma.StockMovementCreateManyInput[] = [];
  for (const [sku, perMain, perSecond, type] of use) {
    const p = products.get(sku);
    if (!p) continue;
    const batches = await prisma.stockBatch.findMany({ where: { productId: p.id }, include: { levels: true } });
    for (const [branchId, locId, perWeek] of [[main.id, mainLoc.id, perMain], [second.id, secondLoc.id, perSecond]] as const) {
      if (!perWeek) continue;
      const batch = batches.find((b) => b.levels.some((l) => l.locationId === locId)) ?? batches[0];
      if (!batch) continue;
      for (let w = 0; w < 8; w++) {
        // Busier recently (a gentle rise), split over three days a week.
        const weekQty = Math.max(1, Math.round(perWeek * (0.85 + (7 - w) * 0.03)));
        const parts = [Math.ceil(weekQty / 3), Math.ceil(weekQty / 3), weekQty - 2 * Math.ceil(weekQty / 3)].filter((x) => x > 0);
        parts.forEach((q, i) => {
          rows.push({ organizationId: orgId, branchId, productId: p.id, batchId: batch.id, locationId: locId, type, quantity: -q, balanceAfter: 0, unitCostMinor: batch.unitCostMinor, referenceType: 'DemoHistory', createdByName: 'Demo history', createdAt: new Date(Date.now() - (w * 7 + 1 + i * 2) * DAY - 3 * 3600_000) });
        });
      }
    }
  }
  await prisma.stockMovement.createMany({ data: rows });
}
