import { Injectable } from '@nestjs/common';
import { BreedingEvent, Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { breedingEventSchema } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { branchToday, resolveTimezone } from '../../common/time/branch-timezone';
import { addDays, localDateOnly } from '../../common/time/tz';
import { normalizeIdentifier, patientNo } from '../patients/patients.service';

const DAY = 86400_000;
type BreedingInput = z.infer<typeof breedingEventSchema>;

export type ReproductiveState = 'OPEN' | 'SERVED' | 'PREGNANT' | 'DUE_SOON' | 'OVERDUE' | 'DRY';

/**
 * Derives a female's current reproductive state from her (non-voided) breeding history, newest first.
 * Due dates come only from a recorded date or the species' configured, sourced gestation length.
 * `today` is the branch-local calendar date (see `branchToday`).
 */
export function reproductiveState(events: Pick<BreedingEvent, 'type' | 'occurredAt' | 'result' | 'expectedDueDate'>[], today: Date, now = new Date()) {
  const latestOf = (...types: string[]) => events.find((e) => types.includes(e.type));
  const service = latestOf('SERVICE', 'INSEMINATION');
  const end = latestOf('BIRTH', 'ABORTION');
  const check = latestOf('PREGNANCY_CHECK');
  const dry = latestOf('DRY_OFF');
  const after = (a?: { occurredAt: Date }, b?: { occurredAt: Date }) => !!a && (!b || a.occurredAt > b.occurredAt);
  let state: ReproductiveState = 'OPEN';
  let expectedDueDate: Date | null = null;
  if (after(service, end)) {
    state = 'SERVED';
    expectedDueDate = service!.expectedDueDate;
    if (check && after(check, service)) {
      if (check.result === 'PREGNANT') {
        state = 'PREGNANT';
        expectedDueDate = check.expectedDueDate ?? expectedDueDate;
      } else if (check.result === 'NOT_PREGNANT') {
        state = 'OPEN';
        expectedDueDate = null;
      }
    }
    if (state === 'PREGNANT' && expectedDueDate) {
      const days = (expectedDueDate.getTime() - today.getTime()) / DAY;
      if (days < 0) state = 'OVERDUE';
      else if (days <= 30) state = 'DUE_SOON';
    }
  }
  if (state === 'OPEN' && dry && after(dry, end)) state = 'DRY';
  return {
    state,
    expectedDueDate,
    lastHeat: latestOf('HEAT')?.occurredAt ?? null,
    lastService: service?.occurredAt ?? null,
    lastBirth: latestOf('BIRTH')?.occurredAt ?? null,
    daysSinceBirth: latestOf('BIRTH') ? Math.floor((now.getTime() - latestOf('BIRTH')!.occurredAt.getTime()) / DAY) : null,
  };
}

@Injectable()
export class BreedingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
  ) {}

  private async female(patientId: string) {
    const p = await this.prisma.db.patient.findUnique({
      where: { id: patientId },
      include: { species: true, ownerships: { where: { endedAt: null, isPrimary: true } } },
    });
    if (!p) throw notFound('Animal');
    if (p.status !== 'ACTIVE') throw ruleViolation('PATIENT_INACTIVE', `${p.name} is not active`);
    if (!p.sex.startsWith('FEMALE')) throw ruleViolation('NOT_FEMALE', 'Breeding records are kept on the female');
    return p;
  }

  async record(input: BreedingInput) {
    const dam = await this.female(input.patientId);
    if (input.sireId) {
      const sire = await this.prisma.db.patient.findUnique({ where: { id: input.sireId } });
      if (!sire || !sire.sex.startsWith('MALE')) throw ruleViolation('INVALID_SIRE', 'The sire must be a registered male');
      if (sire.speciesId !== dam.speciesId) throw ruleViolation('SPECIES_MISMATCH', 'The sire is a different species');
    }
    if (input.occurredAt.getTime() > Date.now() + 3600_000) throw ruleViolation('FUTURE_DATE', 'Breeding events are recorded after they happen');
    const history = await this.prisma.db.breedingEvent.findMany({ where: { patientId: dam.id, voidedAt: null }, orderBy: { occurredAt: 'desc' } });
    const lastService = history.find((e) => e.type === 'SERVICE' || e.type === 'INSEMINATION');

    // Expected due date: entered by the vet, or calculated from the species' configured gestation length.
    let expectedDueDate = input.expectedDueDate ?? null;
    let dueDateSource: string | null = expectedDueDate ? 'Entered by clinician' : null;
    const gestation = dam.species.gestationDays;
    const tz = await resolveTimezone(this.prisma);
    if (!expectedDueDate && gestation) {
      const from = input.type === 'SERVICE' || input.type === 'INSEMINATION' ? input.occurredAt : input.type === 'PREGNANCY_CHECK' && input.result === 'PREGNANT' && lastService ? lastService.occurredAt : null;
      if (from) {
        expectedDueDate = addDays(localDateOnly(from, tz), gestation);
        dueDateSource = `${dam.species.name} gestation ${gestation} days — ${dam.species.gestationSource ?? 'clinic setting'}`;
      }
    }
    if (input.type === 'PREGNANCY_CHECK' && input.result !== 'PREGNANT') {
      expectedDueDate = null;
      dueDateSource = null;
    }

    const ctx = RequestContext.require();
    const sireId = input.sireId ?? (input.type === 'BIRTH' ? lastService?.sireId ?? null : null);
    const offspringTags = input.offspring.map((o) => (o.tag ? normalizeIdentifier(o.tag) : null)).filter(Boolean) as string[];
    if (offspringTags.length) {
      const taken = await this.prisma.db.patientIdentifier.findMany({ where: { type: 'EAR_TAG', value: { in: offspringTags } }, select: { value: true } });
      if (taken.length) throw conflict(`Tag already registered: ${taken.map((t) => t.value).join(', ')}`);
    }
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const event = await tx.breedingEvent.create({
          data: {
            organizationId: ctx.organizationId!,
            patientId: dam.id,
            type: input.type,
            occurredAt: input.occurredAt,
            sireId,
            sireText: input.sireText ?? (input.type === 'BIRTH' ? lastService?.sireText ?? null : null),
            semenBatch: input.semenBatch,
            technician: input.technician,
            method: input.method,
            result: input.type === 'PREGNANCY_CHECK' ? input.result : null,
            expectedDueDate,
            dueDateSource,
            offspringCount: input.type === 'BIRTH' ? input.offspring.length : null,
            liveCount: input.type === 'BIRTH' ? input.offspring.filter((o) => o.alive).length : null,
            notes: input.notes,
            recordedById: ctx.userId,
            recordedByName: ctx.userName ?? 'Unknown',
          },
        });
        const offspring: { id: string; name: string }[] = [];
        if (input.type === 'BIRTH') {
          const owner = dam.ownerships[0];
          if (!owner) throw ruleViolation('NO_OWNER', 'The dam has no current owner to register the offspring to');
          for (const [i, o] of input.offspring.entries()) {
            const number = await this.counters.next(tx, 'patient');
            const tag = o.tag ? normalizeIdentifier(o.tag) : null;
            const child = await tx.patient.create({
              data: {
                organizationId: ctx.organizationId!,
                number,
                name: o.name || tag || `${dam.name} offspring ${i + 1}`,
                speciesId: dam.speciesId,
                breedId: dam.breedId,
                breedText: dam.breedText,
                sex: o.sex,
                dateOfBirth: localDateOnly(input.occurredAt, tz),
                status: o.alive ? 'ACTIVE' : 'DECEASED',
                deceasedAt: o.alive ? null : input.occurredAt,
                causeOfDeath: o.alive ? null : 'Stillborn',
                damId: dam.id,
                sireId,
                farmId: o.alive ? dam.farmId : null,
                groupId: o.alive ? dam.groupId : null,
                primaryBranchId: dam.primaryBranchId,
                createdById: ctx.userId,
              },
            });
            await tx.patientOwnership.create({ data: { organizationId: ctx.organizationId!, patientId: child.id, clientId: owner.clientId, isPrimary: true } });
            if (tag) await tx.patientIdentifier.create({ data: { organizationId: ctx.organizationId!, patientId: child.id, type: 'EAR_TAG', value: tag } });
            await tx.livestockMovement.create({ data: { organizationId: ctx.organizationId!, type: o.alive ? 'BIRTH' : 'DEATH', patientId: child.id, toFarmId: dam.farmId, toGroupId: dam.groupId, occurredAt: input.occurredAt, reason: o.alive ? `Born to ${dam.name}` : 'Stillborn', recordedById: ctx.userId, recordedByName: ctx.userName ?? 'Unknown' } });
            offspring.push({ id: child.id, name: child.name });
          }
        }
        await this.audit.record({ action: `breeding.${input.type.toLowerCase()}`, entityType: 'Patient', entityId: dam.id, summary: `${input.type.toLowerCase().replace('_', ' ')}${input.result ? `: ${input.result.toLowerCase().replace('_', ' ')}` : ''}${offspring.length ? ` — ${offspring.length} offspring` : ''}` }, tx);
        return { ...event, offspring };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('An offspring tag is already registered');
      throw e;
    }
  }

  async void(id: string, reason: string) {
    const e = await this.prisma.db.breedingEvent.findUnique({ where: { id } });
    if (!e) throw notFound('Breeding record');
    if (e.voidedAt) throw ruleViolation('ALREADY_VOIDED', 'This record was already voided');
    if (e.type === 'BIRTH') throw ruleViolation('BIRTH_RECORD', 'Birth records register animals and cannot be voided; correct the offspring records instead');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.breedingEvent.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, voidedByName: ctx.userName } });
      await this.audit.record({ action: 'breeding.voided', entityType: 'Patient', entityId: e.patientId, summary: `${e.type.toLowerCase()} record voided: ${reason}` }, tx);
      return after;
    });
  }

  /** A female's breeding history (voided entries included, flagged) and derived state; pedigree for any animal. */
  async forAnimal(patientId: string) {
    const p = await this.prisma.db.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true, sex: true, speciesId: true,
        sire: { select: { id: true, name: true, number: true } },
        dam: { select: { id: true, name: true, number: true } },
        sireOf: { select: { id: true, name: true, number: true, dateOfBirth: true, sex: true, status: true }, orderBy: { dateOfBirth: 'desc' }, take: 50 },
        damOf: { select: { id: true, name: true, number: true, dateOfBirth: true, sex: true, status: true }, orderBy: { dateOfBirth: 'desc' }, take: 50 },
      },
    });
    if (!p) throw notFound('Animal');
    const events = await this.prisma.db.breedingEvent.findMany({
      where: { OR: [{ patientId }, { sireId: patientId }] },
      include: { sire: { select: { id: true, name: true, number: true } }, patient: { select: { id: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    const own = events.filter((e) => e.patientId === patientId && !e.voidedAt);
    const shapeRel = (r: { number: number } | null) => (r ? { ...r, patientNo: patientNo(r.number) } : null);
    return {
      events,
      status: p.sex.startsWith('FEMALE') ? reproductiveState(own, await branchToday(this.prisma)) : null,
      pedigree: { sire: shapeRel(p.sire), dam: shapeRel(p.dam), offspring: [...p.damOf, ...p.sireOf].map((o) => ({ ...o, patientNo: patientNo(o.number) })) },
    };
  }

  /** Breeding females on a farm with their current reproductive state (for the herd fertility list). */
  async herd(farmId: string) {
    const females = await this.prisma.db.patient.findMany({
      where: { farmId, status: 'ACTIVE', sex: 'FEMALE' },
      select: {
        id: true, name: true, number: true, dateOfBirth: true,
        group: { select: { id: true, name: true } },
        species: { select: { name: true } },
        identifiers: { where: { type: 'EAR_TAG' }, select: { value: true } },
        breedingEvents: { where: { voidedAt: null }, orderBy: { occurredAt: 'desc' }, take: 20, select: { type: true, occurredAt: true, result: true, expectedDueDate: true } },
      },
      orderBy: { name: 'asc' },
    });
    const today = await branchToday(this.prisma);
    return females.map((f) => ({ id: f.id, name: f.name, patientNo: patientNo(f.number), tag: f.identifiers[0]?.value ?? null, group: f.group, species: f.species.name, dateOfBirth: f.dateOfBirth, ...reproductiveState(f.breedingEvents, today) }));
  }

  /** Births expected within the next `days` days (and overdue ones), across farms or for one farm. */
  async dueSoon(days = 30, farmId?: string) {
    const rows = await this.prisma.db.patient.findMany({
      where: { status: 'ACTIVE', farmId: farmId ?? { not: null }, breedingEvents: { some: { voidedAt: null, expectedDueDate: { not: null, lte: new Date(Date.now() + days * DAY) } } } },
      select: {
        id: true, name: true, number: true,
        farm: { select: { id: true, name: true } },
        identifiers: { where: { type: 'EAR_TAG' }, select: { value: true } },
        breedingEvents: { where: { voidedAt: null }, orderBy: { occurredAt: 'desc' }, take: 20, select: { type: true, occurredAt: true, result: true, expectedDueDate: true } },
      },
    });
    const today = await branchToday(this.prisma);
    return rows
      .map((r) => ({ id: r.id, name: r.name, patientNo: patientNo(r.number), tag: r.identifiers[0]?.value ?? null, farm: r.farm, ...reproductiveState(r.breedingEvents, today) }))
      .filter((r) => ['SERVED', 'PREGNANT', 'DUE_SOON', 'OVERDUE'].includes(r.state) && r.expectedDueDate && r.expectedDueDate.getTime() <= Date.now() + days * DAY)
      .sort((a, b) => a.expectedDueDate!.getTime() - b.expectedDueDate!.getTime());
  }
}
