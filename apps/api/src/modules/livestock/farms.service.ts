import { Injectable } from '@nestjs/common';
import { LivestockEventType, Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { animalGroupSchema, bulkAnimalsSchema, farmSchema, movementSchema, updateFarmSchema, updateGroupSchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { normalizeIdentifier, patientNo } from '../patients/patients.service';

export const farmNo = (n: number) => formatNumber('FARM', n, 5);
const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

type FarmInput = z.infer<typeof farmSchema>;
type GroupInput = z.infer<typeof animalGroupSchema>;
type MovementInput = z.infer<typeof movementSchema>;

/** Farms, herds/flocks/batches, the animals in them and their movement history. */
@Injectable()
export class FarmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  private ctx() {
    return RequestContext.require();
  }

  // ── Farms ──

  async list(q: { q?: string; clientId?: string; status?: string }) {
    const term = q.q?.trim();
    const farms = await this.prisma.db.farm.findMany({
      where: {
        status: q.status === 'ALL' ? undefined : ((q.status as any) ?? 'ACTIVE'),
        clientId: q.clientId,
        ...(term
          ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { district: { contains: term, mode: 'insensitive' } }, { registrationNumber: { contains: term, mode: 'insensitive' } }, { client: { displayName: { contains: term, mode: 'insensitive' } } }] }
          : {}),
      },
      include: { client: { select: { id: true, displayName: true, mobilePhone: true } }, groups: { where: { status: 'ACTIVE' }, select: { id: true, tracksIndividuals: true, headCount: true } } },
      orderBy: { name: 'asc' },
      take: 200,
    });
    const ids = farms.map((f) => f.id);
    const now = new Date();
    const [animals, outbreaks, withdrawals] = await Promise.all([
      this.prisma.db.patient.groupBy({ by: ['farmId'], where: { farmId: { in: ids }, status: 'ACTIVE' }, _count: true }),
      this.prisma.db.diseaseOutbreak.groupBy({ by: ['farmId'], where: { farmId: { in: ids }, status: { in: ['SUSPECTED', 'CONFIRMED'] } }, _count: true }),
      this.prisma.db.patientWithdrawal.findMany({
        where: { patient: { farmId: { in: ids } }, OR: [{ meatClearAt: { gt: now } }, { milkClearAt: { gt: now } }, { eggClearAt: { gt: now } }] },
        select: { patient: { select: { farmId: true } } },
      }),
    ]);
    return farms.map((f) => ({
      ...shapeFarm(f),
      groupCount: f.groups.length,
      animalCount: (animals.find((a) => a.farmId === f.id)?._count ?? 0) + f.groups.filter((g) => !g.tracksIndividuals).reduce((n, g) => n + g.headCount, 0),
      openOutbreaks: outbreaks.find((o) => o.farmId === f.id)?._count ?? 0,
      animalsUnderWithdrawal: withdrawals.filter((w) => w.patient.farmId === f.id).length,
    }));
  }

  async get(id: string) {
    const f = await this.prisma.db.farm.findUnique({ where: { id }, include: { client: { select: { id: true, displayName: true, mobilePhone: true, email: true } } } });
    if (!f) throw notFound('Farm');
    const groups = await this.groups(id);
    const unassigned = await this.prisma.db.patient.count({ where: { farmId: id, groupId: null, status: 'ACTIVE' } });
    return { ...shapeFarm(f), groups, unassignedAnimals: unassigned };
  }

  private async activeClient(clientId: string) {
    const c = await this.prisma.db.client.findUnique({ where: { id: clientId } });
    if (!c || c.status !== 'ACTIVE') throw ruleViolation('INVALID_CLIENT', 'Owner not found or not active');
    return c;
  }

  async create(input: FarmInput) {
    await this.activeClient(input.clientId);
    const ctx = this.ctx();
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'farm');
      const f = await tx.farm.create({ data: { ...input, organizationId: ctx.organizationId!, number, createdByName: ctx.userName } });
      await this.audit.record({ action: 'farm.created', entityType: 'Farm', entityId: f.id, summary: `${farmNo(number)} ${f.name}` }, tx);
      return shapeFarm(f);
    });
  }

  async update(id: string, input: z.infer<typeof updateFarmSchema>) {
    const before = await this.prisma.db.farm.findUnique({ where: { id } });
    if (!before) throw notFound('Farm');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.farm.update({ where: { id }, data: input });
      await this.audit.record({ action: 'farm.updated', entityType: 'Farm', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
      return shapeFarm(after);
    });
  }

  async farmOrThrow(id: string, tx: ScopedTx | PrismaService['db'] = this.prisma.db) {
    const f = await tx.farm.findUnique({ where: { id } });
    if (!f) throw notFound('Farm');
    return f;
  }

  // ── Groups ──

  async groups(farmId: string, includeClosed = false) {
    const rows = await this.prisma.db.animalGroup.findMany({
      where: { farmId, status: includeClosed ? undefined : 'ACTIVE' },
      include: { species: { select: { id: true, name: true, category: true } } },
      orderBy: { name: 'asc' },
    });
    const counts = await this.prisma.db.patient.groupBy({ by: ['groupId'], where: { groupId: { in: rows.map((g) => g.id) }, status: 'ACTIVE' }, _count: true });
    return rows.map((g) => shapeGroup(g, counts.find((c) => c.groupId === g.id)?._count ?? 0));
  }

  async group(id: string) {
    const g = await this.prisma.db.animalGroup.findUnique({ where: { id }, include: { species: { select: { id: true, name: true, category: true, gestationDays: true } }, farm: { select: { id: true, name: true, number: true, clientId: true } } } });
    if (!g) throw notFound('Group');
    const animals = await this.prisma.db.patient.findMany({
      where: { groupId: id, status: 'ACTIVE' },
      select: { id: true, name: true, number: true, sex: true, dateOfBirth: true, latestWeightKg: true, breedText: true, breed: { select: { name: true } }, identifiers: { where: { type: { in: ['EAR_TAG', 'RFID'] } }, select: { type: true, value: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      ...shapeGroup(g, animals.length),
      farm: { ...g.farm, farmNo: farmNo(g.farm.number) },
      animals: animals.map((a) => ({ ...a, patientNo: patientNo(a.number), latestWeightKg: num(a.latestWeightKg), tag: a.identifiers.find((i) => i.type === 'EAR_TAG')?.value ?? a.identifiers[0]?.value ?? null })),
    };
  }

  /** Current population: registered animals, or the head count for batch-level groups. */
  async population(tx: ScopedTx | PrismaService['db'], g: { id: string; tracksIndividuals: boolean; headCount: number }) {
    if (!g.tracksIndividuals) return g.headCount;
    return tx.patient.count({ where: { groupId: g.id, status: 'ACTIVE' } });
  }

  async createGroup(input: GroupInput) {
    const farm = await this.farmOrThrow(input.farmId);
    if (farm.status !== 'ACTIVE') throw ruleViolation('FARM_INACTIVE', 'This farm is inactive');
    const species = await this.prisma.db.species.findUnique({ where: { id: input.speciesId } });
    if (!species || !species.isActive) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    const ctx = this.ctx();
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const batch = !input.tracksIndividuals;
        const g = await tx.animalGroup.create({
          data: {
            organizationId: ctx.organizationId!,
            farmId: input.farmId,
            name: input.name,
            kind: input.kind,
            speciesId: input.speciesId,
            purpose: input.purpose,
            tracksIndividuals: input.tracksIndividuals,
            headCount: batch ? input.initialCount! : 0,
            initialCount: batch ? input.initialCount! : null,
            placedOn: input.placedOn ?? (batch ? new Date(new Date().toISOString().slice(0, 10)) : null),
            breedText: input.breedText,
            location: input.location,
            notes: input.notes,
          },
        });
        if (batch) {
          await tx.livestockMovement.create({ data: { organizationId: ctx.organizationId!, type: 'PLACEMENT', toFarmId: input.farmId, toGroupId: g.id, headCount: input.initialCount!, occurredAt: g.placedOn ?? new Date(), recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' } });
        }
        await this.audit.record({ action: 'animal_group.created', entityType: 'Farm', entityId: input.farmId, summary: `${g.name} (${g.kind.toLowerCase()}${batch ? `, ${g.headCount} head` : ''})` }, tx);
        return shapeGroup({ ...g, species }, 0);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This farm already has a group with that name');
      throw e;
    }
  }

  async updateGroup(id: string, input: z.infer<typeof updateGroupSchema>) {
    const before = await this.prisma.db.animalGroup.findUnique({ where: { id } });
    if (!before) throw notFound('Group');
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const after = await tx.animalGroup.update({ where: { id }, data: input });
        await this.audit.record({ action: 'animal_group.updated', entityType: 'Farm', entityId: before.farmId, summary: after.name, changes: diff(before, after, Object.keys(input)) }, tx);
        return after;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This farm already has a group with that name');
      throw e;
    }
  }

  async closeGroup(id: string, reason: string) {
    const g = await this.prisma.db.animalGroup.findUnique({ where: { id } });
    if (!g) throw notFound('Group');
    if (g.status === 'CLOSED') throw ruleViolation('ALREADY_CLOSED', 'This group is already closed');
    const pop = await this.population(this.prisma.db, g);
    if (pop > 0) throw ruleViolation('GROUP_NOT_EMPTY', g.tracksIndividuals ? `Move, sell or record the ${pop} animal(s) still in this group first` : `Record the sale or mortality of the remaining ${pop} head first`);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.animalGroup.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedReason: reason } });
      await this.audit.record({ action: 'animal_group.closed', entityType: 'Farm', entityId: g.farmId, summary: `${g.name}: ${reason}` }, tx);
      return after;
    });
  }

  // ── Animals ──

  async bulkAdd(input: z.infer<typeof bulkAnimalsSchema>) {
    const g = await this.prisma.db.animalGroup.findUnique({ where: { id: input.groupId }, include: { farm: true } });
    if (!g || g.status !== 'ACTIVE') throw notFound('Group');
    if (!g.tracksIndividuals) throw ruleViolation('BATCH_GROUP', 'This is a batch group: animals are counted, not registered individually');
    await this.activeClient(g.farm.clientId);
    const tags = input.animals.map((a) => normalizeIdentifier(a.tag));
    const dupInList = tags.find((t, i) => tags.indexOf(t) !== i);
    if (dupInList) throw ruleViolation('DUPLICATE_TAG', `Tag ${dupInList} is listed twice`);
    const existing = await this.prisma.db.patientIdentifier.findMany({ where: { type: 'EAR_TAG', value: { in: tags } }, select: { value: true } });
    if (existing.length) throw conflict(`Already registered: ${existing.map((e) => e.value).join(', ')}`, { code: 'TAG_EXISTS', tags: existing.map((e) => e.value) });
    const ctx = this.ctx();
    const movementType: LivestockEventType = input.source === 'PURCHASE' ? 'PURCHASE' : input.source === 'BIRTH' ? 'BIRTH' : 'PLACEMENT';
    return this.prisma.db.$transaction(
      async (tx) => {
        const created: { id: string; name: string; tag: string }[] = [];
        for (const [i, a] of input.animals.entries()) {
          const number = await this.counters.next(tx, 'patient');
          const p = await tx.patient.create({
            data: {
              organizationId: ctx.organizationId!,
              number,
              name: a.name || tags[i],
              speciesId: g.speciesId,
              breedText: input.breedText ?? g.breedText,
              sex: a.sex,
              dateOfBirth: a.dateOfBirth ?? null,
              farmId: g.farmId,
              groupId: g.id,
              primaryBranchId: ctx.branchId ?? null,
              createdById: ctx.userId,
            },
          });
          await tx.patientOwnership.create({ data: { organizationId: ctx.organizationId!, patientId: p.id, clientId: g.farm.clientId, isPrimary: true } });
          await tx.patientIdentifier.create({ data: { organizationId: ctx.organizationId!, patientId: p.id, type: 'EAR_TAG', value: tags[i] } });
          await tx.livestockMovement.create({ data: { organizationId: ctx.organizationId!, type: movementType, patientId: p.id, toFarmId: g.farmId, toGroupId: g.id, occurredAt: new Date(), counterparty: input.counterparty, recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' } });
          created.push({ id: p.id, name: p.name, tag: tags[i] });
        }
        await this.audit.record({ action: 'livestock.animals_registered', entityType: 'Farm', entityId: g.farmId, summary: `${created.length} animal(s) added to ${g.name}` }, tx);
        return { created };
      },
      { timeout: 60_000 },
    );
  }

  /** Puts an already-registered animal on a farm/group (or takes it off). */
  async assign(patientId: string, farmId: string | null | undefined, groupId: string | null | undefined) {
    const p = await this.prisma.db.patient.findUnique({ where: { id: patientId }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!p || p.status !== 'ACTIVE') throw ruleViolation('INVALID_PATIENT', 'Animal not found or not active');
    let group = null;
    if (groupId) {
      group = await this.prisma.db.animalGroup.findUnique({ where: { id: groupId } });
      if (!group || group.status !== 'ACTIVE') throw notFound('Group');
      if (!group.tracksIndividuals) throw ruleViolation('BATCH_GROUP', 'Animals cannot be registered into a batch group');
      if (group.speciesId !== p.speciesId) throw ruleViolation('SPECIES_MISMATCH', 'This group is for a different species');
      if (farmId && farmId !== group.farmId) throw ruleViolation('GROUP_FARM', 'This group belongs to another farm');
      farmId = group.farmId;
    }
    if (farmId) {
      const farm = await this.farmOrThrow(farmId);
      if (p.ownerships[0] && p.ownerships[0].clientId !== farm.clientId) throw ruleViolation('OWNER_MISMATCH', 'This animal belongs to a different client than the farm owner');
    }
    const ctx = this.ctx();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.patient.update({ where: { id: patientId }, data: { farmId: farmId ?? null, groupId: groupId ?? null } });
      if (after.groupId !== p.groupId || after.farmId !== p.farmId) {
        await tx.livestockMovement.create({ data: { organizationId: ctx.organizationId!, type: 'MOVE', patientId, fromFarmId: p.farmId, toFarmId: after.farmId, fromGroupId: p.groupId, toGroupId: after.groupId, occurredAt: new Date(), recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' } });
      }
      await this.audit.record({ action: 'livestock.animal_assigned', entityType: 'Patient', entityId: patientId, summary: group ? `Group ${group.name}` : farmId ? 'Farm assigned' : 'Removed from farm' }, tx);
      return after;
    });
  }

  // ── Movements, sales, deaths and culls ──

  async move(input: MovementInput) {
    const ctx = this.ctx();
    const base = { organizationId: ctx.organizationId!, type: input.type as LivestockEventType, occurredAt: input.occurredAt, counterparty: input.counterparty, reason: input.reason, recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' };
    const toGroup = input.toGroupId ? await this.prisma.db.animalGroup.findUnique({ where: { id: input.toGroupId } }) : null;
    if (input.toGroupId && (!toGroup || toGroup.status !== 'ACTIVE')) throw notFound('Destination group');

    if (input.patientIds.length) {
      const animals = await this.prisma.db.patient.findMany({ where: { id: { in: input.patientIds } }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
      if (animals.length !== input.patientIds.length) throw ruleViolation('INVALID_PATIENT', 'One or more animals were not found');
      const inactive = animals.find((a) => a.status !== 'ACTIVE');
      if (inactive) throw ruleViolation('PATIENT_INACTIVE', `${inactive.name} is not active`);
      if (toGroup) {
        if (!toGroup.tracksIndividuals) throw ruleViolation('BATCH_GROUP', 'Individually registered animals cannot be moved into a batch group');
        const destFarm = await this.farmOrThrow(toGroup.farmId);
        const wrong = animals.find((a) => a.speciesId !== toGroup.speciesId);
        if (wrong) throw ruleViolation('SPECIES_MISMATCH', `${wrong.name} is a different species from the destination group`);
        const otherOwner = animals.find((a) => a.ownerships[0] && a.ownerships[0].clientId !== destFarm.clientId);
        if (otherOwner) throw ruleViolation('OWNER_MISMATCH', `${otherOwner.name} belongs to a different owner; record a sale/transfer instead`);
      }
      const unit = input.priceMinor != null && animals.length > 1 ? Math.round(input.priceMinor / animals.length) : input.priceMinor;
      return this.prisma.db.$transaction(async (tx) => {
        for (const a of animals) {
          await tx.livestockMovement.create({ data: { ...base, patientId: a.id, fromFarmId: a.farmId, fromGroupId: a.groupId, toFarmId: toGroup?.farmId ?? null, toGroupId: toGroup?.id ?? null, priceMinor: unit ?? null } });
          if (input.type === 'MOVE') await tx.patient.update({ where: { id: a.id }, data: { farmId: toGroup!.farmId, groupId: toGroup!.id } });
          else if (input.type === 'SALE' || input.type === 'TRANSFER') await tx.patient.update({ where: { id: a.id }, data: { status: 'TRANSFERRED', groupId: null } });
          else await tx.patient.update({ where: { id: a.id }, data: { status: 'DECEASED', deceasedAt: input.occurredAt, causeOfDeath: input.type === 'CULL' ? `Culled: ${input.reason}` : input.reason, euthanasia: input.type === 'CULL' ? true : null, groupId: null } });
        }
        await this.audit.record({ action: `livestock.${input.type.toLowerCase()}`, entityType: 'Farm', entityId: animals[0].farmId ?? animals[0].id, summary: `${animals.length} animal(s): ${animals.map((a) => a.name).slice(0, 10).join(', ')}${input.reason ? ` — ${input.reason}` : ''}` }, tx);
        return { moved: animals.length };
      });
    }

    // Batch group: a head count leaves (or moves to another batch).
    const g = await this.prisma.db.animalGroup.findUnique({ where: { id: input.groupId! } });
    if (!g || g.status !== 'ACTIVE') throw notFound('Group');
    if (g.tracksIndividuals) throw ruleViolation('INDIVIDUAL_GROUP', 'Choose the individual animals for this group');
    if (input.type === 'DEATH') throw ruleViolation('USE_MORTALITY', 'Record batch deaths as daily mortality under Production');
    if (toGroup && (toGroup.tracksIndividuals || toGroup.speciesId !== g.speciesId)) throw ruleViolation('INVALID_DESTINATION', 'Batches can only be split into another batch of the same species');
    const count = input.headCount!;
    return this.prisma.db.$transaction(async (tx) => {
      // Lock the batch row so concurrent entries cannot take the count below zero.
      const rows = (await tx.$queryRaw`SELECT "headCount" FROM "AnimalGroup" WHERE id = ${g.id}::uuid AND "organizationId" = ${ctx.organizationId}::uuid FOR UPDATE`) as { headCount: number }[];
      if (count > rows[0].headCount) throw ruleViolation('INSUFFICIENT_HEAD', `Only ${rows[0].headCount} head in ${g.name}`);
      await tx.animalGroup.update({ where: { id: g.id }, data: { headCount: { decrement: count } } });
      if (toGroup) await tx.animalGroup.update({ where: { id: toGroup.id }, data: { headCount: { increment: count } } });
      await tx.livestockMovement.create({ data: { ...base, headCount: count, fromFarmId: g.farmId, fromGroupId: g.id, toFarmId: toGroup?.farmId ?? null, toGroupId: toGroup?.id ?? null, priceMinor: input.priceMinor ?? null } });
      await this.audit.record({ action: `livestock.${input.type.toLowerCase()}`, entityType: 'Farm', entityId: g.farmId, summary: `${count} head from ${g.name}${input.reason ? ` — ${input.reason}` : ''}` }, tx);
      return { moved: count };
    });
  }

  async movements(q: { farmId?: string; patientId?: string; groupId?: string; limit?: number }) {
    const rows = await this.prisma.db.livestockMovement.findMany({
      where: {
        patientId: q.patientId,
        ...(q.farmId ? { OR: [{ fromFarmId: q.farmId }, { toFarmId: q.farmId }] } : {}),
        ...(q.groupId ? { OR: [{ fromGroupId: q.groupId }, { toGroupId: q.groupId }] } : {}),
      },
      include: { patient: { select: { id: true, name: true, number: true } }, fromGroup: { select: { id: true, name: true } }, toGroup: { select: { id: true, name: true } }, fromFarm: { select: { id: true, name: true } }, toFarm: { select: { id: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(q.limit ?? 200, 500),
    });
    return rows;
  }

  // ── Food-safety withdrawal board ──

  async withdrawals(farmId?: string) {
    const now = new Date();
    const active = { OR: [{ meatClearAt: { gt: now } }, { milkClearAt: { gt: now } }, { eggClearAt: { gt: now } }] };
    const [animals, groups] = await Promise.all([
      this.prisma.db.patientWithdrawal.findMany({
        where: { ...active, patient: farmId ? { farmId } : { farmId: { not: null } } },
        include: { product: { select: { id: true, name: true } }, patient: { select: { id: true, name: true, number: true, farmId: true, farm: { select: { id: true, name: true } }, identifiers: { where: { type: 'EAR_TAG' }, select: { value: true } } } } },
        orderBy: { treatedAt: 'desc' },
      }),
      this.prisma.db.groupTreatment.findMany({
        where: { ...active, farmId, group: { tracksIndividuals: false } },
        include: { group: { select: { id: true, name: true } }, farm: { select: { id: true, name: true } } },
        orderBy: { administeredAt: 'desc' },
      }),
    ]);
    const flags = (r: { meatClearAt: Date | null; milkClearAt: Date | null; eggClearAt: Date | null }) => ({
      meatActive: !!r.meatClearAt && r.meatClearAt > now,
      milkActive: !!r.milkClearAt && r.milkClearAt > now,
      eggActive: !!r.eggClearAt && r.eggClearAt > now,
    });
    return [
      ...animals.map((w) => ({ id: w.id, subjectType: 'ANIMAL' as const, subject: { id: w.patient.id, name: w.patient.name, tag: w.patient.identifiers[0]?.value ?? patientNo(w.patient.number) }, farm: w.patient.farm, product: w.product.name, treatedAt: w.treatedAt, meatClearAt: w.meatClearAt, milkClearAt: w.milkClearAt, eggClearAt: w.eggClearAt, source: w.source, ...flags(w) })),
      ...groups.map((t) => ({ id: t.id, subjectType: 'BATCH' as const, subject: { id: t.group!.id, name: t.group!.name, tag: `${t.headCount} head` }, farm: t.farm, product: t.productName, treatedAt: t.administeredAt, meatClearAt: t.meatClearAt, milkClearAt: t.milkClearAt, eggClearAt: t.eggClearAt, source: t.withdrawalSource ?? '', ...flags(t) })),
    ].sort((a, b) => Math.max(+(b.meatClearAt ?? 0), +(b.milkClearAt ?? 0), +(b.eggClearAt ?? 0)) - Math.max(+(a.meatClearAt ?? 0), +(a.milkClearAt ?? 0), +(a.eggClearAt ?? 0)));
  }

  // ── Farm health & productivity report ──

  async report(farmId: string, from: Date, to: Date) {
    const farm = await this.farmOrThrow(farmId);
    const db = this.prisma.db;
    const inPeriod = { gte: from, lte: to };
    const dayFrom = new Date(from.toISOString().slice(0, 10));
    const dayTo = new Date(to.toISOString().slice(0, 10));
    const [census, groups, movements, breeding, production, treatments, outbreaksOpen, outbreaksNew, withdrawals] = await Promise.all([
      db.patient.groupBy({ by: ['speciesId', 'sex'], where: { farmId, status: 'ACTIVE' }, _count: true }),
      db.animalGroup.findMany({ where: { farmId }, include: { species: { select: { name: true } } } }),
      db.livestockMovement.findMany({ where: { occurredAt: inPeriod, OR: [{ fromFarmId: farmId }, { toFarmId: farmId }] }, select: { type: true, headCount: true, patientId: true, fromFarmId: true, priceMinor: true } }),
      db.breedingEvent.findMany({ where: { voidedAt: null, occurredAt: inPeriod, patient: { farmId } }, select: { type: true, result: true, offspringCount: true, liveCount: true, patientId: true } }),
      db.productionRecord.findMany({ where: { farmId, voidedAt: null, recordedOn: { gte: dayFrom, lte: dayTo } }, select: { kind: true, quantity: true, patientId: true, groupId: true, recordedOn: true, unit: true } }),
      db.groupTreatment.count({ where: { farmId, administeredAt: inPeriod } }),
      db.diseaseOutbreak.count({ where: { farmId, status: { in: ['SUSPECTED', 'CONFIRMED', 'CONTROLLED'] } } }),
      db.diseaseOutbreak.findMany({ where: { farmId, firstSeenOn: { gte: dayFrom, lte: dayTo } }, select: { id: true, disease: true, status: true, affectedCount: true, deathCount: true } }),
      this.withdrawals(farmId),
    ]);
    const speciesNames = new Map((await db.species.findMany({ where: { id: { in: census.map((c) => c.speciesId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const bySpecies = new Map<string, { species: string; total: number; female: number; male: number }>();
    for (const c of census) {
      const name = speciesNames.get(c.speciesId) ?? 'Unknown';
      const e = bySpecies.get(name) ?? { species: name, total: 0, female: 0, male: 0 };
      e.total += c._count;
      if (c.sex.startsWith('FEMALE')) e.female += c._count;
      if (c.sex.startsWith('MALE')) e.male += c._count;
      bySpecies.set(name, e);
    }
    const sumMoves = (types: string[], out = true) => movements.filter((m) => types.includes(m.type) && (!out || m.fromFarmId === farmId)).reduce((n, m) => n + m.headCount, 0);
    const deaths = sumMoves(['DEATH']);
    const culls = sumMoves(['CULL']);
    const sold = sumMoves(['SALE', 'TRANSFER']);
    const salesValueMinor = movements.filter((m) => ['SALE'].includes(m.type) && m.fromFarmId === farmId).reduce((n, m) => n + (m.priceMinor ?? 0), 0);
    const individuals = [...bySpecies.values()].reduce((n, s) => n + s.total, 0);
    const services = breeding.filter((b) => b.type === 'SERVICE' || b.type === 'INSEMINATION').length;
    const checks = breeding.filter((b) => b.type === 'PREGNANCY_CHECK' && b.result !== 'INCONCLUSIVE');
    const pregnant = checks.filter((b) => b.result === 'PREGNANT').length;
    const births = breeding.filter((b) => b.type === 'BIRTH');
    const sum = (kind: string) => production.filter((p) => p.kind === kind).reduce((n, p) => n + Number(p.quantity), 0);
    const milk = production.filter((p) => p.kind === 'MILK' && p.patientId);
    const cowDays = new Set(milk.map((m) => `${m.patientId}:${m.recordedOn.toISOString().slice(0, 10)}`)).size;
    const milkPerAnimal = milk.reduce((n, m) => n + Number(m.quantity), 0);
    const batches = groups.filter((g) => !g.tracksIndividuals).map((g) => {
      const mort = production.filter((p) => p.kind === 'MORTALITY' && p.groupId === g.id).reduce((n, p) => n + Number(p.quantity), 0);
      const lastWeight = production.filter((p) => p.kind === 'BATCH_WEIGHT' && p.groupId === g.id).sort((a, b) => +b.recordedOn - +a.recordedOn)[0];
      return {
        id: g.id, name: g.name, species: g.species.name, purpose: g.purpose, status: g.status, placedOn: g.placedOn, initialCount: g.initialCount, headCount: g.headCount,
        ageDays: g.placedOn ? Math.floor((Date.now() - g.placedOn.getTime()) / 86400_000) : null,
        mortalityInPeriod: mort,
        cumulativeMortalityPct: g.initialCount ? Math.round(((g.initialCount - g.headCount) / g.initialCount) * 1000) / 10 : null,
        eggs: production.filter((p) => p.kind === 'EGGS' && p.groupId === g.id).reduce((n, p) => n + Number(p.quantity), 0),
        feedKg: production.filter((p) => p.kind === 'FEED' && p.groupId === g.id).reduce((n, p) => n + Number(p.quantity), 0),
        latestAvgWeightKg: lastWeight ? Number(lastWeight.quantity) : null,
      };
    });
    return {
      farm: shapeFarm(farm),
      period: { from, to },
      census: { individuals, bySpecies: [...bySpecies.values()], batchHead: batches.filter((b) => b.status === 'ACTIVE').reduce((n, b) => n + b.headCount, 0) },
      movements: { births: births.reduce((n, b) => n + (b.liveCount ?? 0), 0), purchased: movements.filter((m) => m.type === 'PURCHASE').reduce((n, m) => n + m.headCount, 0), sold, deaths, culls, salesValueMinor },
      mortalityRatePct: individuals + deaths > 0 ? Math.round((deaths / (individuals + deaths + culls + sold)) * 1000) / 10 : null,
      breeding: {
        services,
        pregnancyChecks: checks.length,
        pregnant,
        pregnancyRatePct: checks.length ? Math.round((pregnant / checks.length) * 1000) / 10 : null,
        births: births.length,
        bornAlive: births.reduce((n, b) => n + (b.liveCount ?? 0), 0),
        stillborn: births.reduce((n, b) => n + ((b.offspringCount ?? 0) - (b.liveCount ?? 0)), 0),
        abortions: breeding.filter((b) => b.type === 'ABORTION').length,
      },
      production: {
        milkLitres: Math.round(sum('MILK') * 10) / 10,
        avgMilkPerAnimalDay: cowDays ? Math.round((milkPerAnimal / cowDays) * 10) / 10 : null,
        eggs: sum('EGGS'),
        feedKg: Math.round(sum('FEED') * 10) / 10,
        batchMortality: sum('MORTALITY'),
      },
      batches,
      health: { treatments, openOutbreaks: outbreaksOpen, newOutbreaks: outbreaksNew, activeWithdrawals: withdrawals.length },
    };
  }

  /** Organisation-wide livestock overview for the module landing page. */
  async overview() {
    const db = this.prisma.db;
    const [farms, animals, batchHead, outbreaks, withdrawals] = await Promise.all([
      db.farm.count({ where: { status: 'ACTIVE' } }),
      db.patient.count({ where: { farmId: { not: null }, status: 'ACTIVE' } }),
      db.animalGroup.aggregate({ where: { status: 'ACTIVE', tracksIndividuals: false }, _sum: { headCount: true } }),
      db.diseaseOutbreak.count({ where: { status: { in: ['SUSPECTED', 'CONFIRMED'] } } }),
      this.withdrawals(),
    ]);
    return { farms, animals, batchHead: batchHead._sum.headCount ?? 0, openOutbreaks: outbreaks, activeWithdrawals: withdrawals.length };
  }
}

export function shapeFarm<T extends { number: number; latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; areaHectares: Prisma.Decimal | null }>(f: T) {
  return { ...f, farmNo: farmNo(f.number), latitude: num(f.latitude), longitude: num(f.longitude), areaHectares: num(f.areaHectares) };
}

export function shapeGroup<T extends { tracksIndividuals: boolean; headCount: number; placedOn: Date | null }>(g: T, individuals: number) {
  return { ...g, population: g.tracksIndividuals ? individuals : g.headCount, ageDays: g.placedOn ? Math.floor((Date.now() - g.placedOn.getTime()) / 86400_000) : null };
}
