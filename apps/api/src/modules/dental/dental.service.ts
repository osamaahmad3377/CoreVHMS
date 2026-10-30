import { Injectable } from '@nestjs/common';
import { Prisma, type DentalChart, type DentalProcedure, type DentalToothFinding } from '@prisma/client';
import {
  DENTAL_PROCEDURES,
  dentalProcedure,
  dentitionForSpecies,
  forDentition,
  toothInfo,
  worstStage,
  type DentalChartCreateInput,
  type DentalChartUpdateInput,
  type DentalPricesInput,
  type DentalProcedureInput,
  type DentalToothInput,
  type Dentition,
} from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { sha256 } from '../../common/crypto/crypto';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { patientNo } from '../patients/patients.service';

export const dentalChartNo = (n: number) => formatNumber('DEN', n);

const CHART_FIELDS = ['dentition', 'showDeciduous', 'examinedAt', 'anaesthetised', 'occlusion', 'periodontalStage', 'calculusIndex', 'gingivalIndex', 'oralFindings', 'homeCare', 'notes', 'recheckDate'] as const;
const TOOTH_FIELDS = ['tooth', 'state', 'findings', 'trStage', 'pdStage', 'mobility', 'furcation', 'calculus', 'gingivitis', 'probingMm', 'recessionMm', 'notes'] as const;

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v));

/** Deterministic hash of everything a signed chart says, plus who signed it and when (tamper evidence). */
export function dentalContentHash(chart: Pick<DentalChart, (typeof CHART_FIELDS)[number]>, teeth: DentalToothFinding[], procedures: DentalProcedure[], signedById: string, signedAt: Date) {
  const v = (x: unknown) => (x instanceof Date ? x.toISOString() : x instanceof Prisma.Decimal ? Number(x) : (x ?? null));
  return sha256(
    JSON.stringify({
      chart: Object.fromEntries(CHART_FIELDS.map((f) => [f, v((chart as any)[f])])),
      teeth: [...teeth].sort((a, b) => a.tooth.localeCompare(b.tooth)).map((t) => Object.fromEntries(TOOTH_FIELDS.map((f) => [f, f === 'findings' ? [...t.findings].sort() : v((t as any)[f])]))),
      procedures: [...procedures].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, tooth: p.tooth, code: p.code, serviceId: p.serviceId, notes: p.notes })),
      signedById,
      signedAt: signedAt.toISOString(),
    }),
  );
}

/** A tooth row with nothing on it is not stored. */
function isBlank(t: DentalToothInput) {
  return t.state === 'PRESENT' && !t.findings.length && [t.trStage, t.pdStage, t.mobility, t.furcation, t.calculus, t.gingivitis, t.probingMm, t.recessionMm, t.notes].every((x) => x == null || x === '');
}

const chartInclude = {
  patient: { select: { id: true, name: true, number: true, sex: true, dateOfBirth: true, species: { select: { id: true, name: true, category: true } }, breed: { select: { name: true } }, breedText: true } },
  client: { select: { id: true, displayName: true, number: true } },
  teeth: { orderBy: { tooth: 'asc' } },
  procedures: { orderBy: { createdAt: 'asc' }, include: { service: { select: { id: true, name: true, code: true, priceMinor: true } } } },
  addenda: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.DentalChartInclude;
type ChartRow = Prisma.DentalChartGetPayload<{ include: typeof chartInclude }>;

/**
 * Dental charts: a tooth-by-tooth record of a dental examination (modified Triadan numbering) with whole-mouth
 * scores and the procedures done. Procedures are charged as they are recorded (with the service mapped in
 * Settings → Dental prices). Signing locks the chart — database trigger included — and later notes are addenda.
 */
@Injectable()
export class DentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly charges: ChargeCaptureService,
  ) {}

  private shape(c: ChartRow) {
    const removed = new Set(c.procedures.filter((p) => p.tooth && dentalProcedure(p.code)?.removesTooth).map((p) => p.tooth!));
    return {
      ...c,
      chartNo: dentalChartNo(c.number),
      patient: { ...c.patient, patientNo: patientNo(c.patient.number) },
      recheckDate: c.recheckDate ? c.recheckDate.toISOString().slice(0, 10) : null,
      teeth: c.teeth.map((t) => ({ ...t, probingMm: num(t.probingMm), recessionMm: num(t.recessionMm) })),
      procedures: c.procedures.map((p) => ({ ...p, label: dentalProcedure(p.code)?.label ?? p.code })),
      /** Teeth extracted at this visit. */
      extractedNow: [...removed],
      worstToothStage: worstStage(c.teeth),
    };
  }

  private async load(id: string, db: ScopedTx | PrismaService['db'] = this.prisma.db) {
    const c = await db.dentalChart.findUnique({ where: { id }, include: chartInclude });
    if (!c) throw notFound('Dental chart');
    return c;
  }

  private async draft(id: string, db: ScopedTx | PrismaService['db'] = this.prisma.db) {
    const c = await this.load(id, db);
    if (c.status === 'SIGNED') throw ruleViolation('CHART_SIGNED', 'This dental chart is signed and locked. Add an addendum instead.');
    return c;
  }

  async get(id: string) {
    const c = await this.load(id);
    const [previous, charges] = await Promise.all([
      c.previousChartId ? this.prisma.db.dentalChart.findUnique({ where: { id: c.previousChartId }, select: { id: true, number: true, examinedAt: true, periodontalStage: true } }) : null,
      this.prisma.db.charge.findMany({ where: { sourceType: 'DentalProcedure', sourceId: { in: c.procedures.map((p) => p.id) } }, select: { id: true, sourceId: true, status: true, unitPriceMinor: true, discountMinor: true, discountNote: true } }),
    ]);
    const shaped = this.shape(c);
    return {
      ...shaped,
      previous: previous ? { ...previous, chartNo: dentalChartNo(previous.number) } : null,
      procedures: shaped.procedures.map((p) => ({ ...p, charge: charges.find((x) => x.sourceId === p.id) ?? null })),
      integrity: c.status === 'SIGNED' ? (dentalContentHash(c, c.teeth, c.procedures, c.signedById!, c.signedAt!) === c.contentHash ? 'VERIFIED' : 'MISMATCH') : null,
    };
  }

  async list(q: { status: 'DRAFT' | 'SIGNED' | 'ALL'; patientId?: string; page: number; pageSize: number }) {
    const where: Prisma.DentalChartWhereInput = { status: q.status === 'ALL' ? undefined : q.status, patientId: q.patientId };
    const [rows, total] = await Promise.all([
      this.prisma.db.dentalChart.findMany({
        where,
        include: { patient: { select: { id: true, name: true, number: true, species: { select: { name: true } } } }, client: { select: { id: true, displayName: true } }, _count: { select: { procedures: true, teeth: true } } },
        orderBy: [{ status: 'asc' }, { examinedAt: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.db.dentalChart.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({ ...r, chartNo: dentalChartNo(r.number), patient: { ...r.patient, patientNo: patientNo(r.patient.number) } })),
      total,
      q,
    );
  }

  /** The patient's charts (newest first, with teeth for the tooth history) and the dentition to suggest. */
  async forPatient(patientId: string) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId }, include: { species: true } });
    if (!patient) throw notFound('Patient');
    const charts = await this.prisma.db.dentalChart.findMany({ where: { patientId }, include: chartInclude, orderBy: { examinedAt: 'desc' } });
    return {
      suggestedDentition: dentitionForSpecies(patient.species.name, patient.species.category),
      charts: charts.map((c) => this.shape(c)),
    };
  }

  // ── Creating and editing a draft ──

  async create(input: DentalChartCreateInput) {
    const ctx = RequestContext.require();
    const db = this.prisma.db;
    const patient = await db.patient.findUnique({ where: { id: input.patientId } });
    if (!patient || patient.status === 'MERGED') throw notFound('Patient');
    const owner = await db.patientOwnership.findFirst({ where: { patientId: patient.id, endedAt: null, isPrimary: true } });
    if (!owner) throw ruleViolation('NO_OWNER', `${patient.name} has no current owner`);
    if (input.encounterId) {
      const e = await db.encounter.findUnique({ where: { id: input.encounterId } });
      if (!e || e.patientId !== patient.id) throw ruleViolation('INVALID_ENCOUNTER', 'That consultation is not for this patient');
    }
    const branchId = ctx.branchId ?? patient.primaryBranchId;
    if (!branchId) throw ruleViolation('BRANCH_REQUIRED', 'Choose a branch first');
    // Start from the last signed chart of the same kind: teeth missing or extracted then are still gone.
    const previous = input.carryForward
      ? await db.dentalChart.findFirst({ where: { patientId: patient.id, status: 'SIGNED', dentition: input.dentition }, include: { teeth: true, procedures: true }, orderBy: { examinedAt: 'desc' } })
      : null;
    const gone = new Map<string, 'MISSING' | 'EXTRACTED'>();
    for (const t of previous?.teeth ?? []) if (t.state === 'MISSING' || t.state === 'EXTRACTED') gone.set(t.tooth, t.state);
    for (const p of previous?.procedures ?? []) if (p.tooth && dentalProcedure(p.code)?.removesTooth) gone.set(p.tooth, 'EXTRACTED');
    const id = await db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'dental');
      const c = await tx.dentalChart.create({
        data: {
          organizationId: ctx.organizationId!,
          number,
          branchId,
          patientId: patient.id,
          clientId: owner.clientId,
          encounterId: input.encounterId ?? null,
          dentition: input.dentition,
          showDeciduous: input.showDeciduous,
          examinedAt: input.examinedAt ?? new Date(),
          previousChartId: previous?.id ?? null,
          clinicianId: ctx.membershipId ?? null,
          clinicianName: ctx.userName ?? 'Unknown',
          createdById: ctx.userId!,
        },
      });
      if (gone.size) await tx.dentalToothFinding.createMany({ data: [...gone].map(([tooth, state]) => ({ organizationId: ctx.organizationId!, chartId: c.id, tooth, state })) });
      await this.audit.record({ action: 'dental.chart_started', entityType: 'Patient', entityId: patient.id, summary: `${dentalChartNo(number)}${previous ? `, from ${dentalChartNo(previous.number)} (${gone.size} teeth already gone)` : ''}` }, tx);
      return c.id;
    });
    return this.get(id);
  }

  private assertTeeth(dentition: Dentition, teeth: string[]) {
    const bad = teeth.filter((t) => !toothInfo(dentition, t));
    if (bad.length) throw ruleViolation('INVALID_TOOTH', `${bad.join(', ')} ${bad.length === 1 ? 'is not a tooth' : 'are not teeth'} on a ${dentition.toLowerCase()} chart`);
  }

  async update(id: string, input: DentalChartUpdateInput) {
    const before = await this.draft(id);
    if (input.dentition && input.dentition !== before.dentition) {
      const used = [...before.teeth.map((t) => t.tooth), ...before.procedures.map((p) => p.tooth).filter((t): t is string => !!t)];
      if (used.some((t) => !toothInfo(input.dentition!, t))) throw ruleViolation('DENTITION_IN_USE', 'Teeth are already recorded on this chart. Clear them before changing the chart type.');
    }
    const data: Prisma.DentalChartUncheckedUpdateInput = {};
    for (const f of CHART_FIELDS) {
      const v = (input as any)[f];
      if (v === undefined) continue;
      (data as any)[f] = f === 'recheckDate' ? (v ? new Date(`${v}T00:00:00.000Z`) : null) : f === 'examinedAt' ? (v ?? before.examinedAt) : v;
    }
    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.dentalChart.update({ where: { id }, data });
      await this.audit.record({ action: 'dental.chart_updated', entityType: 'Patient', entityId: before.patientId, summary: dentalChartNo(before.number), changes: diff(before, after, Object.keys(data)) }, tx);
    });
    return this.get(id);
  }

  async saveTeeth(id: string, teeth: DentalToothInput[]) {
    const chart = await this.draft(id);
    this.assertTeeth(chart.dentition, teeth.map((t) => t.tooth));
    if (new Set(teeth.map((t) => t.tooth)).size !== teeth.length) throw ruleViolation('DUPLICATE_TOOTH', 'Each tooth can be saved once per request');
    const removedHere = new Set(chart.procedures.filter((p) => p.tooth && dentalProcedure(p.code)?.removesTooth).map((p) => p.tooth));
    for (const t of teeth) {
      if (t.state !== 'PRESENT' && removedHere.has(t.tooth)) throw ruleViolation('EXTRACTED_TODAY', `${t.tooth} was extracted at this visit — remove the extraction first to mark it ${t.state.toLowerCase()}`);
    }
    await this.prisma.db.$transaction(async (tx) => {
      for (const t of teeth) {
        if (isBlank(t)) {
          await tx.dentalToothFinding.deleteMany({ where: { chartId: id, tooth: t.tooth } });
          continue;
        }
        const data = {
          state: t.state,
          findings: [...new Set(t.findings)],
          trStage: t.findings.includes('TR') ? (t.trStage ?? null) : null,
          pdStage: t.pdStage ?? null,
          mobility: t.mobility ?? null,
          furcation: t.furcation ?? null,
          calculus: t.calculus ?? null,
          gingivitis: t.gingivitis ?? null,
          probingMm: t.probingMm ?? null,
          recessionMm: t.recessionMm ?? null,
          notes: t.notes ?? null,
        };
        await tx.dentalToothFinding.upsert({ where: { chartId_tooth: { chartId: id, tooth: t.tooth } }, create: { ...data, organizationId: RequestContext.orgId(), chartId: id, tooth: t.tooth }, update: data });
      }
      await this.audit.record({ action: 'dental.teeth_recorded', entityType: 'Patient', entityId: chart.patientId, summary: `${dentalChartNo(chart.number)}: ${teeth.map((t) => t.tooth).join(', ')}`.slice(0, 500) }, tx);
    });
    return this.get(id);
  }

  async addProcedure(id: string, input: DentalProcedureInput) {
    const chart = await this.draft(id);
    const code = dentalProcedure(input.code)!;
    if (!forDentition(DENTAL_PROCEDURES, chart.dentition).some((p) => p.code === code.code)) throw ruleViolation('INVALID_PROCEDURE', `${code.label} is not used on a ${chart.dentition.toLowerCase()} chart`);
    if (code.scope === 'tooth' && !input.teeth.length) throw ruleViolation('TOOTH_REQUIRED', `Choose the tooth for ${code.label.toLowerCase()}`);
    if (code.scope === 'mouth' && input.teeth.length) throw ruleViolation('WHOLE_MOUTH', `${code.label} is recorded for the whole mouth, not per tooth`);
    const teeth = [...new Set(input.teeth)];
    this.assertTeeth(chart.dentition, teeth);
    const gone = chart.teeth.filter((t) => teeth.includes(t.tooth) && t.state !== 'PRESENT');
    if (gone.length) throw ruleViolation('TOOTH_ABSENT', `${gone.map((t) => t.tooth).join(', ')} ${gone.length === 1 ? 'is' : 'are'} recorded as ${gone[0].state.toLowerCase()}`);
    if (code.removesTooth) {
      const twice = chart.procedures.filter((p) => p.tooth && teeth.includes(p.tooth) && dentalProcedure(p.code)?.removesTooth);
      if (twice.length) throw ruleViolation('ALREADY_EXTRACTED', `${twice.map((p) => p.tooth).join(', ')} already has an extraction recorded`);
    }
    const priced = await this.prisma.db.dentalProcedurePrice.findUnique({ where: { organizationId_code: { organizationId: RequestContext.orgId(), code: code.code } } });
    const serviceId = input.serviceId ?? priced?.serviceId ?? null;
    const service = serviceId ? await this.prisma.db.service.findUnique({ where: { id: serviceId } }) : null;
    if (serviceId && (!service || !service.isActive)) throw ruleViolation('INVALID_SERVICE', 'That price-list service was not found or is switched off');
    const userName = RequestContext.get()?.userName ?? 'Unknown';
    await this.prisma.db.$transaction(async (tx) => {
      const tax = service ? await this.charges.taxFor(tx, service.taxRateId) : 0;
      for (const tooth of teeth.length ? teeth : [null]) {
        const p = await tx.dentalProcedure.create({ data: { organizationId: RequestContext.orgId(), chartId: id, tooth, code: code.code, serviceId: service?.id ?? null, notes: input.notes ?? null, recordedByName: userName } });
        if (service) {
          await this.charges.capture(tx, {
            sourceType: 'DentalProcedure',
            sourceId: p.id,
            clientId: chart.clientId,
            patientId: chart.patientId,
            encounterId: chart.encounterId,
            branchId: chart.branchId,
            kind: 'SERVICE',
            serviceId: service.id,
            description: `${service.name}${tooth ? ` — tooth ${tooth}` : ''} (${dentalChartNo(chart.number)})`,
            quantity: 1,
            unitPriceMinor: service.priceMinor,
            taxRateBasisPoints: tax,
          });
        }
      }
      await this.audit.record({ action: 'dental.procedure_added', entityType: 'Patient', entityId: chart.patientId, summary: `${dentalChartNo(chart.number)}: ${code.label}${teeth.length ? ` on ${teeth.join(', ')}` : ''}${service ? '' : ' (not charged — no price set)'}` }, tx);
    });
    return this.get(id);
  }

  async removeProcedure(id: string, procedureId: string) {
    const chart = await this.draft(id);
    const p = chart.procedures.find((x) => x.id === procedureId);
    if (!p) throw notFound('Procedure');
    const charge = await this.prisma.db.charge.findFirst({ where: { sourceType: 'DentalProcedure', sourceId: p.id } });
    if (charge?.status === 'INVOICED') throw ruleViolation('ALREADY_INVOICED', 'This procedure is already on an invoice. Remove it from the invoice first.');
    await this.prisma.db.$transaction(async (tx) => {
      await this.charges.waiveForSource(tx, 'DentalProcedure', [p.id], `Dental procedure removed from ${dentalChartNo(chart.number)}`);
      await tx.dentalProcedure.delete({ where: { id: p.id } });
      await this.audit.record({ action: 'dental.procedure_removed', entityType: 'Patient', entityId: chart.patientId, summary: `${dentalChartNo(chart.number)}: ${dentalProcedure(p.code)?.label ?? p.code}${p.tooth ? ` on ${p.tooth}` : ''}` }, tx);
    });
    return this.get(id);
  }

  async sign(id: string) {
    const ctx = RequestContext.require();
    const chart = await this.draft(id);
    const hasContent = chart.teeth.length || chart.procedures.length || chart.periodontalStage != null || chart.calculusIndex != null || chart.gingivalIndex != null || chart.occlusion || chart.oralFindings?.trim();
    if (!hasContent) throw ruleViolation('EMPTY_CHART', 'Record at least one finding, score or procedure before signing');
    const signedAt = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      // Re-read inside the transaction so the hash covers exactly what is locked.
      const c = await this.draft(id, tx);
      const contentHash = dentalContentHash(c, c.teeth, c.procedures, ctx.userId!, signedAt);
      await tx.dentalChart.update({ where: { id }, data: { status: 'SIGNED', signedAt, signedById: ctx.userId!, signedByName: ctx.userName ?? 'Unknown', contentHash } });
      const stage = c.periodontalStage ?? worstStage(c.teeth);
      const extracted = c.procedures.filter((p) => dentalProcedure(p.code)?.removesTooth).length;
      await this.audit.record({ action: 'dental.signed', entityType: 'Patient', entityId: c.patientId, summary: `${dentalChartNo(c.number)}${stage != null ? ` PD${stage}` : ''}, ${c.procedures.length} procedure(s)${extracted ? `, ${extracted} extraction(s)` : ''}` }, tx);
    });
    return this.get(id);
  }

  async addAddendum(id: string, text: string) {
    const ctx = RequestContext.require();
    const chart = await this.load(id);
    if (chart.status !== 'SIGNED') throw ruleViolation('NOT_SIGNED', 'This chart is still a draft — edit it directly');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.dentalChartAddendum.create({ data: { organizationId: ctx.organizationId!, chartId: id, text, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'dental.addendum', entityType: 'Patient', entityId: chart.patientId, summary: `${dentalChartNo(chart.number)}: ${text}`.slice(0, 500) }, tx);
    });
    return this.get(id);
  }

  /** Deletes a draft chart. Its procedures' unbilled charges are waived; an invoiced one blocks the discard. */
  async discard(id: string) {
    const chart = await this.draft(id);
    const ids = chart.procedures.map((p) => p.id);
    if (ids.length && (await this.prisma.db.charge.count({ where: { sourceType: 'DentalProcedure', sourceId: { in: ids }, status: 'INVOICED' } }))) {
      throw ruleViolation('ALREADY_INVOICED', 'Procedures on this chart are already invoiced. Sign the chart instead, or remove them from the invoice first.');
    }
    await this.prisma.db.$transaction(async (tx) => {
      await this.charges.waiveForSource(tx, 'DentalProcedure', ids, `Dental chart ${dentalChartNo(chart.number)} discarded`);
      await tx.dentalChart.delete({ where: { id } });
      await this.audit.record({ action: 'dental.chart_discarded', entityType: 'Patient', entityId: chart.patientId, summary: dentalChartNo(chart.number) }, tx);
    });
    return { ok: true };
  }

  // ── Prices ──

  async prices() {
    const rows = await this.prisma.db.dentalProcedurePrice.findMany({ include: { service: { select: { id: true, name: true, code: true, priceMinor: true, isActive: true } } } });
    return DENTAL_PROCEDURES.map((p) => ({ code: p.code, label: p.label, abbr: p.abbr, scope: p.scope, dentitions: p.dentitions ?? null, service: rows.find((r) => r.code === p.code)?.service ?? null }));
  }

  async savePrices(input: DentalPricesInput) {
    const ids = [...new Set(input.items.map((i) => i.serviceId).filter((x): x is string => !!x))];
    const found = ids.length ? await this.prisma.db.service.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } }) : [];
    if (found.length !== ids.length) throw ruleViolation('INVALID_SERVICE', 'A chosen service was not found or is switched off');
    await this.prisma.db.$transaction(async (tx) => {
      for (const i of input.items) {
        if (i.serviceId) {
          await tx.dentalProcedurePrice.upsert({ where: { organizationId_code: { organizationId: RequestContext.orgId(), code: i.code } }, create: { organizationId: RequestContext.orgId(), code: i.code, serviceId: i.serviceId }, update: { serviceId: i.serviceId } });
        } else {
          await tx.dentalProcedurePrice.deleteMany({ where: { code: i.code } });
        }
      }
      await this.audit.record({ action: 'settings.dental_prices', entityType: 'Organization', entityId: RequestContext.orgId(), summary: `${input.items.filter((i) => i.serviceId).length} dental procedure(s) priced` }, tx);
    });
    return this.prices();
  }
}
