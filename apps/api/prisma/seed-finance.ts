import type { PrismaClient } from '@prisma/client';
import { calcLine } from '@vcms/shared';
import type { SeededOrg } from './seed-modules';

/**
 * Demo inventory and finance data (Milestone 5). All prices, costs and stock levels are illustrative.
 * Tax: Australian GST is 10% and veterinary services are taxable; Pakistan sales tax on services is
 * provincial and varies, so the PK demo uses an explicitly-labelled 0% rate that must be configured
 * by the practice with its tax adviser.
 */
export async function seedFinance(prisma: PrismaClient, s: SeededOrg) {
  const orgId = s.org.id;
  const pk = s.org.country === 'PK';
  const branch = s.branches[0];
  const ownerEmail = Object.keys(s.staffIds).find((e) => e.startsWith('owner@'))!;
  const ownerId = s.staffIds[ownerEmail];
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
  const next = async (key: string) => {
    const r = await prisma.$queryRaw<{ value: number }[]>`INSERT INTO "Counter" ("organizationId","key","value") VALUES (${orgId}::uuid, ${key}, 1) ON CONFLICT ("organizationId","key") DO UPDATE SET "value" = "Counter"."value" + 1 RETURNING "value"`;
    return Number(r[0].value);
  };

  await prisma.organization.update({ where: { id: orgId }, data: { pricesIncludeTax: !pk, paymentTermsDays: pk ? 0 : 14, requireCashSession: true, allowNegativeStock: false } });
  const tax = await prisma.taxRate.create({
    data: pk
      ? { organizationId: orgId, name: 'Demo: no tax (configure your provincial sales tax)', rateBasisPoints: 0, isDefault: true }
      : { organizationId: orgId, name: 'GST', rateBasisPoints: 1000, isDefault: true },
  });
  if (!pk) await prisma.taxRate.create({ data: { organizationId: orgId, name: 'GST-free', rateBasisPoints: 0 } });

  // Services, linked to appointment types so completed consultations are billed automatically.
  const types = await prisma.appointmentType.findMany({ where: { organizationId: orgId } });
  const svcDefs: [string, string, string, number, string?][] = [
    ['CONS', 'Consultation', 'CONSULTATION', pk ? 200000 : 9500, 'Consultation'],
    ['VACC', 'Vaccination consultation', 'VACCINATION', pk ? 150000 : 7000, 'Vaccination'],
    ['FUP', 'Follow-up consultation', 'CONSULTATION', pk ? 100000 : 5500, 'Follow-up'],
    ['EMERG', 'Emergency consultation', 'CONSULTATION', pk ? 400000 : 18000, 'Emergency'],
    ['FARM', 'Farm visit (first hour)', 'FIELD_VISIT', pk ? 500000 : 25000, 'Farm visit'],
    ['GROOM', 'Full groom', 'GROOMING', pk ? 250000 : 8000, 'Grooming'],
    ['NAIL', 'Nail clip', 'PROCEDURE', pk ? 50000 : 2500],
    ['DENT', 'Dental scale & polish', 'DENTAL', pk ? 1200000 : 45000],
  ];
  const services: Record<string, { id: string; name: string; priceMinor: number }> = {};
  for (const [code, name, category, priceMinor, typeName] of svcDefs) {
    const svc = await prisma.service.create({ data: { organizationId: orgId, code, name, category: category as any, priceMinor } });
    services[code] = svc;
    const t = typeName && types.find((x) => x.name === typeName);
    if (t) await prisma.appointmentType.update({ where: { id: t.id }, data: { serviceId: svc.id } });
  }

  // Stock locations and a cash register per branch
  const locations: Record<string, string> = {};
  for (const [i, b] of s.branches.entries()) {
    const main = await prisma.stockLocation.create({ data: { organizationId: orgId, branchId: b.id, name: i === 0 ? 'Main pharmacy' : 'Pharmacy', type: 'PHARMACY', isDefault: true } });
    locations[b.id] = main.id;
    if (i === 0) await prisma.stockLocation.create({ data: { organizationId: orgId, branchId: b.id, name: 'Store room', type: 'STORE' } });
    const reg = await prisma.cashRegister.create({ data: { organizationId: orgId, branchId: b.id, name: 'Reception' } });
    if (i === 0) await prisma.cashSession.create({ data: { organizationId: orgId, registerId: reg.id, branchId: b.id, openingFloatMinor: pk ? 500000 : 20000, openedById: owner.id, openedByName: owner.name } });
  }

  const supplier = await prisma.supplier.create({
    data: { organizationId: orgId, name: pk ? 'Demo Pharma Distributors (Lahore)' : 'Demo Veterinary Wholesale Pty Ltd', contactName: pk ? 'Sales desk' : 'Customer service', phone: pk ? '+92 42 0000 0000' : '+61 2 0000 0000', paymentTermsDays: 30, notes: 'Demo supplier' },
  });

  // Opening stock (demo quantities). Ketamine is low on purpose; one vaccine batch expires soon.
  const products = await prisma.product.findMany({ where: { organizationId: orgId } });
  const day = 86400_000;
  const plan: Record<string, { qty: number; cost: number; expiresInDays: number; reorder?: [number, number] }[]> = {
    AMX250: [{ qty: 200, cost: pk ? 1500 : 40, expiresInDays: 420, reorder: [60, 200] }],
    MLX15: [{ qty: 250, cost: pk ? 1000 : 30, expiresInDays: 300, reorder: [50, 250] }],
    MTZ200: [{ qty: 120, cost: pk ? 900 : 25, expiresInDays: 500, reorder: [40, 120] }],
    IVM10: [{ qty: 500, cost: pk ? 500 : 20, expiresInDays: 365 }],
    OTC200: [{ qty: 300, cost: pk ? 400 : 15, expiresInDays: 250 }],
    KET100: [{ qty: 8, cost: pk ? 6000 : 300, expiresInDays: 200, reorder: [10, 20] }],
    'VAC-RAB': [{ qty: 6, cost: pk ? 60000 : 1800, expiresInDays: 25 }, { qty: 30, cost: pk ? 62000 : 1850, expiresInDays: 330, reorder: [10, 30] }],
    'VAC-DHP': [{ qty: 25, cost: pk ? 75000 : 2600, expiresInDays: 280, reorder: [10, 25] }],
    SYR3: [{ qty: 400, cost: pk ? 800 : 12, expiresInDays: 900 }],
    'ECOL-M': [{ qty: 12, cost: pk ? 40000 : 800, expiresInDays: 3650, reorder: [4, 12] }],
    'FD-DOG3': [{ qty: 20, cost: pk ? 320000 : 2400, expiresInDays: 300, reorder: [5, 20] }],
    'FD-CAT85': [{ qty: 96, cost: pk ? 15000 : 110, expiresInDays: 540, reorder: [24, 96] }],
    'TR-DENT7': [{ qty: 30, cost: pk ? 80000 : 750, expiresInDays: 365 }],
    'GR-SHMP250': [{ qty: 15, cost: pk ? 55000 : 950, expiresInDays: 900 }],
    'GR-BRUSH': [{ qty: 10, cost: pk ? 40000 : 800, expiresInDays: 3650 }],
    'AC-COLLAR-M': [{ qty: 18, cost: pk ? 30000 : 600, expiresInDays: 3650 }],
    'AC-TOY-L': [{ qty: 25, cost: pk ? 25000 : 450, expiresInDays: 3650 }],
    'SP-JOINT60': [{ qty: 12, cost: pk ? 230000 : 2100, expiresInDays: 400 }],
  };
  const receipt = await prisma.goodsReceipt.create({
    data: { organizationId: orgId, branchId: branch.id, number: await next('goods_receipt'), supplierId: supplier.id, locationId: locations[branch.id], supplierInvoiceNo: 'DEMO-OPENING', notes: 'Opening stock (demo)', receivedById: owner.id, receivedByName: owner.name },
  });
  let receiptTotal = 0;
  for (const p of products) {
    const batches = p.sku ? plan[p.sku] : undefined;
    if (!batches) continue;
    const reorder = batches.find((b) => b.reorder)?.reorder;
    await prisma.product.update({ where: { id: p.id }, data: { trackStock: true, reorderLevel: reorder?.[0] ?? null, reorderQuantity: reorder?.[1] ?? null } });
    for (const [i, b] of batches.entries()) {
      const batch = await prisma.stockBatch.create({
        data: { organizationId: orgId, productId: p.id, batchNumber: `${p.sku}-D${String(i + 1).padStart(2, '0')}`, expiryDate: new Date(new Date(Date.now() + b.expiresInDays * day).toISOString().slice(0, 10)), unitCostMinor: b.cost, supplierId: supplier.id },
      });
      await prisma.stockLevel.create({ data: { organizationId: orgId, productId: p.id, batchId: batch.id, locationId: locations[branch.id], quantity: b.qty } });
      await prisma.goodsReceiptLine.create({ data: { organizationId: orgId, goodsReceiptId: receipt.id, productId: p.id, batchId: batch.id, quantity: b.qty, unitCostMinor: b.cost } });
      await prisma.stockMovement.create({
        data: { organizationId: orgId, branchId: branch.id, productId: p.id, batchId: batch.id, locationId: locations[branch.id], type: 'RECEIPT', quantity: b.qty, balanceAfter: b.qty, unitCostMinor: b.cost, referenceType: 'GoodsReceipt', referenceId: receipt.id, createdById: owner.id, createdByName: owner.name },
      });
      receiptTotal += b.qty * b.cost;
    }
  }
  await prisma.goodsReceipt.update({ where: { id: receipt.id }, data: { totalMinor: receiptTotal } });

  // Consultation charges for consultations already completed in the demo data.
  const encounters = await prisma.encounter.findMany({ where: { organizationId: orgId, status: 'COMPLETED' }, include: { appointment: { include: { appointmentType: true } }, clinician: { include: { user: { select: { name: true } } } } } });
  const charges = [];
  for (const e of encounters) {
    const svc = Object.values(services).find((x) => x.id === e.appointment?.appointmentType.serviceId) ?? services.CONS;
    charges.push(
      await prisma.charge.create({
        data: { organizationId: orgId, branchId: e.branchId, clientId: e.clientId, patientId: e.patientId, encounterId: e.id, sourceType: 'Encounter', sourceId: e.id, kind: 'SERVICE', serviceId: svc.id, description: svc.name, quantity: 1, unitPriceMinor: svc.priceMinor, taxRateBasisPoints: tax.rateBasisPoints, createdByName: e.clinician?.user.name ?? null, createdAt: e.completedAt ?? undefined },
      }),
    );
  }

  // One older consultation invoiced and part-paid, so balances, statements and aged receivables have data.
  const first = charges.find((c) => c.encounterId);
  if (!first) return;
  const amounts = calcLine({ quantity: 1, unitPriceMinor: first.unitPriceMinor, taxRateBasisPoints: first.taxRateBasisPoints }, !pk);
  const issuedAt = new Date(Date.now() - 20 * day);
  const inv = await prisma.invoice.create({
    data: { organizationId: orgId, branchId: first.branchId, clientId: first.clientId, patientId: first.patientId, encounterId: first.encounterId, currency: s.org.currency, pricesIncludeTax: !pk, subtotalMinor: amounts.netMinor, taxMinor: amounts.taxMinor, totalMinor: amounts.grossMinor, balanceMinor: amounts.grossMinor, createdById: owner.id, createdByName: owner.name, createdAt: issuedAt },
  });
  const line = await prisma.invoiceLine.create({
    data: { organizationId: orgId, invoiceId: inv.id, kind: 'SERVICE', description: first.description, serviceId: first.serviceId, quantity: 1, unitPriceMinor: first.unitPriceMinor, taxRateBasisPoints: first.taxRateBasisPoints, ...amounts },
  });
  await prisma.charge.update({ where: { id: first.id }, data: { status: 'INVOICED', invoiceLineId: line.id } });
  await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'ISSUED', number: await next('invoice'), issuedAt, issuedByName: owner.name, dueAt: new Date(issuedAt.getTime() + (pk ? 1 : 14) * day) } });
  const paid = Math.round(amounts.grossMinor / 2);
  const payment = await prisma.payment.create({
    data: { organizationId: orgId, branchId: first.branchId, number: await next('receipt'), clientId: first.clientId, amountMinor: paid, method: 'CARD', reference: 'DEMO', receivedById: owner.id, receivedByName: owner.name, receivedAt: issuedAt },
  });
  await prisma.paymentAllocation.create({ data: { organizationId: orgId, paymentId: payment.id, invoiceId: inv.id, amountMinor: paid, createdAt: issuedAt } });
  await prisma.invoice.update({ where: { id: inv.id }, data: { paidMinor: paid, balanceMinor: amounts.grossMinor - paid, status: 'PARTIALLY_PAID' } });
  await prisma.client.update({ where: { id: first.clientId }, data: { balanceMinor: amounts.grossMinor - paid } });
}
