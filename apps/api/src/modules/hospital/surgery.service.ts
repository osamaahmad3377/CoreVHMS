import { Injectable } from '@nestjs/common';
import { AsaGrade, ChecklistPhase, Prisma, SurgeryPriority, SurgeryRole } from '@prisma/client';
import { AuditService, diff } from '../../common/audit/audit.service';
import { ClientEvents } from '../../common/events/client-events';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChargeCaptureService } from '../billing/charge-capture.service';
import { InventoryService } from '../inventory/inventory.service';
import { AppointmentsService } from '../scheduling/appointments.service';

export const surgeryNo = (n: number) => formatNumber('SURG', n);

export interface ChecklistEntry {
  key: string;
  phase: ChecklistPhase;
  label: string;
  checked: boolean;
  by?: string | null;
  at?: string | null;
}

/**
 * Default surgical safety checklist, adapted from the WHO Surgical Safety Checklist (2009) for veterinary
 * use. Procedural items only (no clinical values); each organisation can edit its own list in Settings.
 */
export const DEFAULT_CHECKLIST: { phase: ChecklistPhase; label: string }[] = [
  { phase: 'SIGN_IN', label: 'Patient identity, procedure and site confirmed with the record' },
  { phase: 'SIGN_IN', label: 'Owner consent recorded' },
  { phase: 'SIGN_IN', label: 'Fasting status confirmed' },
  { phase: 'SIGN_IN', label: 'Known allergies and alerts reviewed' },
  { phase: 'SIGN_IN', label: 'Anaesthetic machine and monitoring equipment checked' },
  { phase: 'SIGN_IN', label: 'Airway equipment and venous access ready' },
  { phase: 'TIME_OUT', label: 'All team members know each other’s role' },
  { phase: 'TIME_OUT', label: 'Procedure, site and positioning confirmed' },
  { phase: 'TIME_OUT', label: 'Antibiotic prophylaxis decision made' },
  { phase: 'TIME_OUT', label: 'Anticipated critical events discussed' },
  { phase: 'TIME_OUT', label: 'Instrument sterility confirmed' },
  { phase: 'SIGN_OUT', label: 'Instrument, swab and needle counts correct' },
  { phase: 'SIGN_OUT', label: 'Specimens labelled' },
  { phase: 'SIGN_OUT', label: 'Equipment problems recorded' },
  { phase: 'SIGN_OUT', label: 'Recovery plan and analgesia agreed' },
];

const include = {
  patient: {
    select: {
      id: true, name: true, number: true, sex: true, dateOfBirth: true, latestWeightKg: true, speciesId: true,
      species: { select: { name: true } }, breed: { select: { name: true } },
      alerts: { where: { isActive: true }, select: { id: true, type: true, severity: true, title: true } },
    },
  },
  client: { select: { id: true, displayName: true, mobilePhone: true } },
  theatre: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, priceMinor: true } },
  admission: { select: { id: true, number: true, status: true } },
  team: { include: { membership: { select: { id: true, user: { select: { name: true } } } } } },
} satisfies Prisma.SurgeryInclude;

type Row = Prisma.SurgeryGetPayload<{ include: typeof include }>;

export function shapeSurgery(s: Row) {
  return {
    ...s,
    surgeryNo: surgeryNo(s.number),
    checklist: s.checklist as unknown as ChecklistEntry[],
    patient: { ...s.patient, latestWeightKg: s.patient.latestWeightKg === null ? null : Number(s.patient.latestWeightKg) },
    admission: s.admission && { ...s.admission, admissionNo: formatNumber('HOSP', s.admission.number) },
    team: s.team.map((t) => ({ id: t.id, role: t.role, membershipId: t.membershipId, name: t.membership.user.name })),
  };
}

@Injectable()
export class SurgeryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly appointments: AppointmentsService,
    private readonly charges: ChargeCaptureService,
    private readonly inventory: InventoryService,
    private readonly events: ClientEvents,
  ) {}

  // ── Checklist template ──

  async checklistTemplate() {
    const db = this.prisma.db;
    let items = await db.surgeryChecklistItem.findMany({ orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] });
    if (!items.length) {
      const orgId = RequestContext.orgId();
      await db.surgeryChecklistItem.createMany({ data: DEFAULT_CHECKLIST.map((d, i) => ({ ...d, organizationId: orgId, sortOrder: i })) });
      items = await db.surgeryChecklistItem.findMany({ orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }] });
    }
    return items;
  }

  async saveChecklistItem(id: string | null, input: { phase: ChecklistPhase; label: string; sortOrder: number; isActive: boolean }) {
    await this.checklistTemplate();
    return this.prisma.db.$transaction(async (tx) => {
      const item = id ? await tx.surgeryChecklistItem.update({ where: { id }, data: input }) : await tx.surgeryChecklistItem.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: id ? 'surgery_checklist.updated' : 'surgery_checklist.created', entityType: 'Organization', entityId: item.organizationId, summary: item.label }, tx);
      return item;
    });
  }

  // ── Scheduling ──

  async schedule(input: {
    patientId: string;
    appointmentTypeId: string;
    surgeonId: string;
    theatreId?: string | null;
    startsAt: Date;
    durationMinutes: number;
    procedure: string;
    serviceId?: string | null;
    priority: SurgeryPriority;
    admissionId?: string | null;
    estimateMinor?: number | null;
    allowOutsideHours: boolean;
  }) {
    const ctx = RequestContext.require();
    const db = this.prisma.db;
    const patient = await db.patient.findUnique({ where: { id: input.patientId } });
    if (!patient || patient.status !== 'ACTIVE') throw ruleViolation('PATIENT_NOT_ACTIVE', 'Only active patients can be scheduled for surgery');
    const owner = await db.patientOwnership.findFirst({ where: { patientId: patient.id, endedAt: null, isPrimary: true } });
    if (!owner) throw ruleViolation('NO_OWNER', 'The patient has no current owner');
    const type = await db.appointmentType.findUnique({ where: { id: input.appointmentTypeId } });
    if (!type || type.category !== 'SURGERY') throw ruleViolation('INVALID_TYPE', 'Choose a surgery appointment type');
    if (input.theatreId) {
      const t = await db.resource.findUnique({ where: { id: input.theatreId } });
      if (!t || !t.isActive || t.type !== 'THEATRE') throw ruleViolation('INVALID_THEATRE', 'Theatre not found');
    }
    if (input.serviceId && !(await db.service.findUnique({ where: { id: input.serviceId } }))) throw notFound('Service');
    if (input.admissionId) {
      const a = await db.admission.findUnique({ where: { id: input.admissionId } });
      if (!a || a.patientId !== patient.id || a.status !== 'ADMITTED') throw ruleViolation('INVALID_ADMISSION', 'The admission must be a current stay of this patient');
    }
    // The booking engine enforces clinician rosters and theatre/clinician double-booking.
    const appt = (await this.appointments.create({
      branchId: ctx.branchId!,
      clientId: owner.clientId,
      patientId: patient.id,
      appointmentTypeId: type.id,
      clinicianId: input.surgeonId,
      resourceIds: input.theatreId ? [input.theatreId] : [],
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      source: 'RECEPTION',
      reason: input.procedure,
      allowOverbook: false,
      allowOutsideHours: input.allowOutsideHours,
    })) as { id: string };
    const template = (await this.checklistTemplate()).filter((i) => i.isActive);
    try {
      const id = await db.$transaction(async (tx) => {
        const number = await this.counters.next(tx, 'surgery');
        const s = await tx.surgery.create({
          data: {
            organizationId: ctx.organizationId!,
            branchId: ctx.branchId!,
            number,
            patientId: patient.id,
            clientId: owner.clientId,
            appointmentId: appt.id,
            admissionId: input.admissionId ?? null,
            procedure: input.procedure,
            serviceId: input.serviceId ?? null,
            theatreId: input.theatreId ?? null,
            scheduledAt: input.startsAt,
            durationMinutes: input.durationMinutes,
            priority: input.priority,
            estimateMinor: input.estimateMinor ?? null,
            checklist: template.map((i) => ({ key: i.id, phase: i.phase, label: i.label, checked: false })) as unknown as Prisma.InputJsonValue,
            createdById: ctx.userId!,
            createdByName: ctx.userName ?? 'Unknown',
          },
        });
        await tx.surgeryTeamMember.create({ data: { organizationId: ctx.organizationId!, surgeryId: s.id, membershipId: input.surgeonId, role: 'SURGEON' } });
        await this.audit.record({ action: 'surgery.scheduled', entityType: 'Patient', entityId: patient.id, summary: `${surgeryNo(number)}: ${input.procedure}` }, tx);
        return s.id;
      });
      return this.get(id);
    } catch (e) {
      // Keep the calendar consistent if the surgical record could not be created.
      await this.appointments.transition(appt.id, 'cancel', 'Surgery could not be scheduled').catch(() => undefined);
      throw e;
    }
  }

  async list(q: { from?: Date; to?: Date; status?: string; patientId?: string }) {
    const rows = await this.prisma.db.surgery.findMany({
      where: {
        scheduledAt: q.from || q.to ? { gte: q.from, lt: q.to } : undefined,
        status: q.status ? { in: q.status.split(',') as any } : undefined,
        patientId: q.patientId,
      },
      include,
      orderBy: { scheduledAt: 'asc' },
      take: 300,
    });
    return rows.map(shapeSurgery);
  }

  async get(id: string) {
    const s = await this.prisma.db.surgery.findUnique({
      where: { id },
      include: {
        ...include,
        readings: { orderBy: { recordedAt: 'asc' } },
        items: { include: { product: { select: { name: true, dispensingUnit: true } } }, orderBy: { createdAt: 'asc' } },
        addenda: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!s) throw notFound('Surgery');
    const administrations = s.encounterId
      ? await this.prisma.db.medicationAdministration.findMany({ where: { encounterId: s.encounterId }, include: { product: { select: { name: true } } }, orderBy: { administeredAt: 'asc' } })
      : [];
    return {
      ...shapeSurgery(s),
      readings: s.readings.map((r) => ({ ...r, temperatureC: r.temperatureC === null ? null : Number(r.temperatureC), agentPercent: r.agentPercent === null ? null : Number(r.agentPercent), oxygenLpm: r.oxygenLpm === null ? null : Number(r.oxygenLpm) })),
      items: s.items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
      addenda: s.addenda,
      administrations: administrations.map((a) => ({ id: a.id, product: a.product.name, dose: Number(a.dose), doseUnit: a.doseUnit, route: a.route, status: a.status, administeredAt: a.administeredAt, administeredByName: a.administeredByName })),
    };
  }

  private async editable(id: string) {
    const s = await this.prisma.db.surgery.findUnique({ where: { id } });
    if (!s) throw notFound('Surgery');
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED') throw ruleViolation('LOCKED', 'This surgical record is closed; add an addendum instead');
    return s;
  }

  async update(id: string, input: Partial<{ procedure: string; serviceId: string | null; asaGrade: AsaGrade | null; asaEmergency: boolean; preOpAssessment: string | null; fastingConfirmed: boolean; anaesthesiaPlan: string | null; airway: string | null; surgicalNotes: string | null; findings: string | null; complications: string | null; postOpInstructions: string | null; followUpAt: Date | null }>) {
    const before = await this.editable(id);
    if (input.serviceId && !(await this.prisma.db.service.findUnique({ where: { id: input.serviceId } }))) throw notFound('Service');
    await this.prisma.db.$transaction(async (tx) => {
      const after = await tx.surgery.update({ where: { id }, data: input });
      await this.audit.record({ action: 'surgery.updated', entityType: 'Surgery', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
    });
    return this.get(id);
  }

  async recordConsent(id: string, givenBy: string, notes?: string | null) {
    const s = await this.editable(id);
    const ctx = RequestContext.require();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.surgery.update({ where: { id }, data: { consentObtained: true, consentGivenBy: givenBy, consentAt: new Date(), consentRecordedBy: ctx.userName } });
      await this.audit.record({ action: 'surgery.consent', entityType: 'Surgery', entityId: id, summary: `Consent given by ${givenBy}${notes ? ` — ${notes}` : ''}` }, tx);
    });
    return this.get(s.id);
  }

  async tickChecklist(id: string, key: string, checked: boolean) {
    const s = await this.editable(id);
    const ctx = RequestContext.require();
    const list = s.checklist as unknown as ChecklistEntry[];
    const item = list.find((i) => i.key === key);
    if (!item) throw notFound('Checklist item');
    const next = list.map((i) => (i.key === key ? { ...i, checked, by: checked ? ctx.userName : null, at: checked ? new Date().toISOString() : null } : i));
    await this.prisma.db.$transaction(async (tx) => {
      await tx.surgery.update({ where: { id }, data: { checklist: next as unknown as Prisma.InputJsonValue } });
      await this.audit.record({ action: checked ? 'surgery.checklist_ticked' : 'surgery.checklist_unticked', entityType: 'Surgery', entityId: id, summary: item.label }, tx);
    });
    return this.get(id);
  }

  async setTeam(id: string, members: { membershipId: string; role: SurgeryRole }[]) {
    await this.editable(id);
    if (!members.some((m) => m.role === 'SURGEON')) throw ruleViolation('SURGEON_REQUIRED', 'At least one surgeon is required');
    const found = await this.prisma.db.membership.findMany({ where: { id: { in: members.map((m) => m.membershipId) }, status: 'ACTIVE' } });
    if (found.length !== new Set(members.map((m) => m.membershipId)).size) throw ruleViolation('INVALID_MEMBER', 'Team member not found');
    const orgId = RequestContext.orgId();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.surgeryTeamMember.deleteMany({ where: { surgeryId: id } });
      await tx.surgeryTeamMember.createMany({ data: members.map((m) => ({ ...m, organizationId: orgId, surgeryId: id })), skipDuplicates: true });
      await this.audit.record({ action: 'surgery.team_updated', entityType: 'Surgery', entityId: id }, tx);
    });
    return this.get(id);
  }

  // ── Workflow ──

  async transition(id: string, action: 'pre-op' | 'start' | 'recovery' | 'complete' | 'cancel', reason?: string | null) {
    const ctx = RequestContext.require();
    const s = await this.editable(id);
    const list = s.checklist as unknown as ChecklistEntry[];
    const unchecked = (...phases: ChecklistPhase[]) => list.filter((i) => phases.includes(i.phase) && !i.checked);
    const from = (...st: (typeof s.status)[]) => {
      if (!st.includes(s.status)) throw ruleViolation('INVALID_TRANSITION', `Cannot ${action} a surgery that is ${s.status.toLowerCase().replace('_', ' ')}`);
    };
    const now = new Date();
    let data: Prisma.SurgeryUncheckedUpdateInput = {};
    let encounterId: string | null = s.encounterId;
    switch (action) {
      case 'pre-op':
        from('SCHEDULED');
        data = { status: 'PRE_OP' };
        break;
      case 'start': {
        from('SCHEDULED', 'PRE_OP');
        if (!s.consentObtained) throw ruleViolation('CONSENT_REQUIRED', 'Record the owner’s consent before starting');
        if (!s.asaGrade) throw ruleViolation('ASA_REQUIRED', 'Record the ASA grade in the pre-operative assessment');
        const missing = unchecked('SIGN_IN', 'TIME_OUT');
        if (missing.length) throw ruleViolation('CHECKLIST_INCOMPLETE', `Complete the safety checklist first: ${missing[0].label}`, { missing: missing.map((m) => m.label) });
        if (s.appointmentId) {
          const appt = await this.prisma.db.appointment.findUnique({ where: { id: s.appointmentId } });
          if (appt && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(appt.status)) encounterId = (await this.appointments.transition(s.appointmentId, 'start')).encounterId;
          else encounterId = (await this.prisma.db.encounter.findUnique({ where: { appointmentId: s.appointmentId } }))?.id ?? encounterId;
        }
        data = { status: 'IN_PROGRESS', startedAt: now, anaesthesiaStartAt: s.anaesthesiaStartAt ?? now, encounterId };
        break;
      }
      case 'recovery': {
        from('IN_PROGRESS');
        const missing = unchecked('SIGN_OUT');
        if (missing.length) throw ruleViolation('CHECKLIST_INCOMPLETE', `Complete the sign-out checklist first: ${missing[0].label}`, { missing: missing.map((m) => m.label) });
        data = { status: 'RECOVERY', endedAt: now, recoveryStartedAt: now };
        break;
      }
      case 'complete':
        from('RECOVERY');
        if (!s.surgicalNotes?.trim()) throw ruleViolation('NOTES_REQUIRED', 'Write the surgical report before completing');
        data = { status: 'COMPLETED', completedAt: now, completedById: ctx.userId, completedByName: ctx.userName, anaesthesiaEndAt: s.anaesthesiaEndAt ?? now };
        break;
      case 'cancel':
        from('SCHEDULED', 'PRE_OP');
        if (!reason) throw ruleViolation('REASON_REQUIRED', 'Give a reason for cancelling');
        if (s.appointmentId) {
          const appt = await this.prisma.db.appointment.findUnique({ where: { id: s.appointmentId } });
          if (appt && ['BOOKED', 'CONFIRMED', 'CHECKED_IN'].includes(appt.status)) await this.appointments.transition(s.appointmentId, 'cancel', `Surgery cancelled: ${reason}`);
        }
        data = { status: 'CANCELLED', cancelledAt: now, cancelReason: reason };
        break;
    }
    await this.prisma.db.$transaction(async (tx) => {
      const r = await tx.surgery.updateMany({ where: { id, status: s.status }, data: data as Prisma.SurgeryUncheckedUpdateManyInput });
      if (!r.count) throw conflict('The surgery was updated by someone else; reload and try again');
      if (action === 'complete' && s.serviceId) {
        const svc = await tx.service.findUniqueOrThrow({ where: { id: s.serviceId } });
        await this.charges.capture(tx, {
          sourceType: 'Surgery',
          sourceId: s.id,
          clientId: s.clientId,
          patientId: s.patientId,
          encounterId,
          branchId: s.branchId,
          kind: 'SERVICE',
          serviceId: svc.id,
          description: `${svc.name} (${surgeryNo(s.number)})`,
          quantity: 1,
          unitPriceMinor: svc.priceMinor,
          taxRateBasisPoints: await this.charges.taxFor(tx, svc.taxRateId),
        });
      }
      if (action === 'complete' && s.followUpAt) {
        const surgeon = await tx.surgeryTeamMember.findFirst({ where: { surgeryId: id, role: 'SURGEON' } });
        await tx.task.create({ data: { organizationId: s.organizationId, branchId: s.branchId, type: 'RECHECK', title: `Post-op check (${surgeryNo(s.number)} ${s.procedure})`.slice(0, 200), dueAt: s.followUpAt, patientId: s.patientId, clientId: s.clientId, encounterId, assigneeId: surgeon?.membershipId ?? null, createdById: ctx.userId, createdByName: ctx.userName } });
      }
      await this.audit.record({ action: `surgery.${action.replace('-', '_')}`, entityType: 'Patient', entityId: s.patientId, summary: [surgeryNo(s.number), s.procedure, reason].filter(Boolean).join(' — ') }, tx);
    });
    if (action === 'complete' && s.appointmentId) {
      const appt = await this.prisma.db.appointment.findUnique({ where: { id: s.appointmentId } });
      if (appt && ['CHECKED_IN', 'IN_CONSULTATION'].includes(appt.status)) await this.appointments.transition(s.appointmentId, 'complete');
    }
    if (action === 'complete') await this.events.emit({ type: 'SURGERY_COMPLETED', surgeryId: id });
    return this.get(id);
  }

  async addReading(id: string, input: Record<string, any> & { phase: 'INTRA_OP' | 'RECOVERY'; recordedAt?: Date | null }) {
    const s = await this.editable(id);
    if (!['PRE_OP', 'IN_PROGRESS', 'RECOVERY'].includes(s.status)) throw ruleViolation('NOT_UNDER_ANAESTHESIA', 'Readings are recorded from pre-op until the record is completed');
    const { phase, recordedAt, notes, ...values } = input;
    if (!Object.values(values).some((v) => v !== null && v !== undefined)) throw ruleViolation('EMPTY_READING', 'Enter at least one measurement');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const r = await tx.anaesthesiaReading.create({ data: { ...values, notes: notes ?? null, phase, recordedAt: recordedAt ?? new Date(), organizationId: ctx.organizationId!, surgeryId: id, recordedById: ctx.userId!, recordedByName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'surgery.reading', entityType: 'Surgery', entityId: id }, tx);
      return r;
    });
  }

  /** Consumables/implants: deducted from stock and charged once, in the same transaction. */
  async addItem(id: string, productId: string, quantity: number, notes?: string | null) {
    const s = await this.editable(id);
    if (!['PRE_OP', 'IN_PROGRESS', 'RECOVERY'].includes(s.status)) throw ruleViolation('NOT_IN_PROGRESS', 'Consumables are recorded during the procedure');
    const product = await this.prisma.db.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) throw ruleViolation('INVALID_PRODUCT', 'Product not found or inactive');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const item = await tx.surgeryItem.create({ data: { organizationId: ctx.organizationId!, surgeryId: id, productId, quantity, notes, recordedByName: ctx.userName ?? 'Unknown' } });
      await this.inventory.issueForEvent(tx, { productId, quantity, branchId: s.branchId, type: 'ADMINISTER', referenceType: 'SurgeryItem', referenceId: item.id });
      await this.charges.capture(tx, {
        sourceType: 'SurgeryItem',
        sourceId: item.id,
        clientId: s.clientId,
        patientId: s.patientId,
        encounterId: s.encounterId,
        branchId: s.branchId,
        kind: 'PRODUCT',
        productId,
        description: `${product.name} — used in surgery (${surgeryNo(s.number)})`,
        quantity,
        unitPriceMinor: product.sellPriceMinor ?? 0,
        taxRateBasisPoints: await this.charges.taxFor(tx, product.taxRateId),
      });
      await this.audit.record({ action: 'surgery.item_used', entityType: 'Surgery', entityId: id, summary: `${product.name} × ${quantity}` }, tx);
      return { ...item, quantity: Number(item.quantity) };
    });
  }

  async addAddendum(id: string, text: string) {
    const s = await this.prisma.db.surgery.findUnique({ where: { id } });
    if (!s) throw notFound('Surgery');
    if (s.status !== 'COMPLETED') throw ruleViolation('NOT_COMPLETED', 'Addenda are added to completed surgical records; edit the record directly until then');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const a = await tx.surgeryAddendum.create({ data: { organizationId: s.organizationId, surgeryId: id, text, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' } });
      await this.audit.record({ action: 'surgery.addendum', entityType: 'Surgery', entityId: id }, tx);
      return a;
    });
  }
}
