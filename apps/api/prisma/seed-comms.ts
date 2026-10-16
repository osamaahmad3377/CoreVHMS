import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/crypto/password';
import type { SeededOrg } from './seed-modules';

const DAY = 86400_000;
const dateOnly = (ms: number) => new Date(new Date(ms).toISOString().slice(0, 10));

/**
 * Demo preventive care, communications and client-portal data (Milestone 7).
 * Protocol schedules are DEMO values to show the workflow — clinics replace them with their own
 * reviewed protocols.
 */
export async function seedComms(prisma: PrismaClient, s: SeededOrg, portal: { email: string; password: string } | null) {
  const orgId = s.org.id;
  const now = Date.now();
  const vet = await prisma.membership.findFirst({ where: { organizationId: orgId, isClinician: true, status: 'ACTIVE' }, include: { user: true } });
  const by = vet?.user.name ?? 'Demo vet';
  const species = await prisma.species.findMany({ where: { organizationId: orgId, name: { in: ['Dog', 'Cat'] } } });
  const dog = species.find((x) => x.name === 'Dog');
  const cat = species.find((x) => x.name === 'Cat');
  const rabies = await prisma.product.findFirst({ where: { organizationId: orgId, sku: 'VAC-RAB' } });
  const dhp = await prisma.product.findFirst({ where: { organizationId: orgId, sku: 'VAC-DHP' } });
  const source = 'DEMO DATA — replace with your clinic’s reviewed protocol and its source';
  const protocol = (data: Record<string, unknown>) => prisma.careProtocol.create({ data: { organizationId: orgId, source, status: 'APPROVED', reviewedByName: by, reviewedAt: new Date(), createdByName: by, ...data } as any });
  const pRabies = await protocol({ name: 'Rabies vaccination (demo schedule)', kind: 'VACCINATION', speciesId: null, productId: rabies?.id ?? null, intervalDays: 365 });
  const pDhp = dog ? await protocol({ name: 'Canine core vaccination (demo schedule)', kind: 'VACCINATION', speciesId: dog.id, productId: dhp?.id ?? null, firstDueAgeWeeks: 8, intervalDays: 365 }) : null;
  const pWorm = await protocol({ name: 'Deworming (demo schedule)', kind: 'DEWORMING', speciesId: null, intervalDays: 90 });
  const pCheck = await protocol({ name: 'Annual health check (demo schedule)', kind: 'HEALTH_CHECK', speciesId: null, intervalDays: 365 });
  void cat;

  // Care plans for companion animals: a mix of due soon, overdue and completed history.
  const companion = s.patients.filter((p) => ['Dog', 'Cat'].includes(p.species));
  for (const [i, p] of companion.entries()) {
    const item = (protocolId: string, kind: string, title: string, dueMs: number, extra: Record<string, unknown> = {}) =>
      prisma.careItem.create({ data: { organizationId: orgId, patientId: p.id, protocolId, kind: kind as any, title, dueDate: dateOnly(dueMs), createdByName: 'Demo seed', ...extra } });
    // History: last year's rabies vaccination given (this year's falls due in the plan below).
    await item(pRabies.id, 'VACCINATION', pRabies.name, now - (330 + i * 7) * DAY, { status: 'COMPLETED', completedAt: new Date(now - (330 + i * 7) * DAY), completedByName: by, productName: rabies?.name ?? null, batchNumber: `RAB-DEMO-${i + 1}` });
    await item(pRabies.id, 'VACCINATION', pRabies.name, now + (35 - i * 7) * DAY);
    await item(pWorm.id, 'DEWORMING', pWorm.name, now + (i % 3 === 0 ? -20 : 6 + i) * DAY);
    if (i % 2 === 0) await item(pCheck.id, 'HEALTH_CHECK', pCheck.name, now + (60 + i) * DAY);
    if (pDhp && p.species === 'Dog' && i === 0) await item(pDhp.id, 'VACCINATION', pDhp.name, now + 10 * DAY);
  }

  // Delivery history so the communication log is not empty.
  const clients = await prisma.client.findMany({ where: { organizationId: orgId, email: { not: null } }, take: 3 });
  for (const [i, c] of clients.entries()) {
    await prisma.outboundMessage.create({
      data: { organizationId: orgId, clientId: c.id, channel: 'EMAIL', recipient: c.email!, subject: `${s.org.country === 'PK' ? 'NextCore' : 'Harbourside'}: care due (demo)`, body: 'Demo reminder message.', purpose: 'CARE_REMINDER', status: 'SENT', attempts: 1, sentAt: new Date(now - (i + 1) * DAY), createdByName: 'System', createdAt: new Date(now - (i + 1) * DAY) },
    });
  }

  if (!portal) return;
  // A demo client with a working portal login, a message thread and an appointment request.
  const owner = companion[0] ? await prisma.patientOwnership.findFirst({ where: { patientId: companion[0].id, endedAt: null, isPrimary: true }, include: { client: true } }) : null;
  if (!owner) return;
  await prisma.client.update({ where: { id: owner.clientId }, data: { email: portal.email, preferredChannel: 'EMAIL' } });
  const user = await prisma.portalUser.upsert({
    where: { email: portal.email },
    update: { passwordHash: await hashPassword(portal.password), status: 'ACTIVE', name: [owner.client.firstName, owner.client.lastName].filter(Boolean).join(' ') || owner.client.displayName },
    create: { email: portal.email, name: [owner.client.firstName, owner.client.lastName].filter(Boolean).join(' ') || owner.client.displayName, passwordHash: await hashPassword(portal.password), status: 'ACTIVE' },
  });
  await prisma.portalAccess.create({ data: { portalUserId: user.id, organizationId: orgId, clientId: owner.clientId, invitedByName: 'Demo seed' } });
  await prisma.clientMessage.createMany({
    data: [
      { organizationId: orgId, clientId: owner.clientId, direction: 'INBOUND', subject: 'Diet question', body: 'Hello, is it fine to switch to the new food gradually over a week? (demo)', authorName: owner.client.displayName, createdAt: new Date(now - 3 * DAY), readAt: new Date(now - 3 * DAY + 3600_000) },
      { organizationId: orgId, clientId: owner.clientId, direction: 'OUTBOUND', body: 'Yes — mix a little more of the new food each day over 7 days. Call us if you notice vomiting or diarrhoea. (demo)', authorName: by, createdAt: new Date(now - 3 * DAY + 2 * 3600_000) },
      { organizationId: orgId, clientId: owner.clientId, direction: 'INBOUND', kind: 'MESSAGE', subject: 'Vaccination reminder', body: 'I got the reminder — can we come next week? (demo)', authorName: owner.client.displayName, createdAt: new Date(now - 2 * 3600_000) },
    ],
  });
  await prisma.appointmentRequest.create({
    data: { organizationId: orgId, clientId: owner.clientId, patientId: companion[0].id, reason: 'Annual vaccination (demo request)', preferredDate: dateOnly(now + 7 * DAY), preferredTime: 'MORNING' },
  });
}
