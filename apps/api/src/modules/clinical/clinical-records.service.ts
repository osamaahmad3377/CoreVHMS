import { Injectable } from '@nestjs/common';
import { DiagnosisStatus, DiagnosisType, Prisma, ProblemStatus, TaskType } from '@prisma/client';
import { listFingerprint, questionsFingerprint, STARTER_TEMPLATE_QUESTIONS, STARTER_V1_FINGERPRINTS, TEMPLATE_LIBRARY_VERSION, templateQuestionSchema, type clinicalTemplateSchema, type VitalsInput } from '@vcms/shared';
import type { z } from 'zod';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { pageArgs, paginated } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { numericVitals } from './encounters.service';

type Flag = 'LOW' | 'HIGH';

/** Runs in the same transaction when a consultation template is created. */
export type TemplateCreatedHook = (tx: ScopedTx, template: { id: string; organizationId: string; name: string; isActive: boolean }) => Promise<void>;

@Injectable()
export class ClinicalRecordsService {
  private readonly templateCreatedHooks: TemplateCreatedHook[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Scheduling registers here so each new template gets its appointment type. */
  registerTemplateCreatedHook(h: TemplateCreatedHook) {
    this.templateCreatedHooks.push(h);
  }

  private async templateCreated(tx: ScopedTx, t: { id: string; organizationId: string; name: string; isActive: boolean }) {
    for (const h of this.templateCreatedHooks) await h(tx, t);
  }

  // ── Vitals ──

  private async references(speciesId: string) {
    return this.prisma.db.vitalReference.findMany({ where: { speciesId } });
  }

  /** Flags values outside the organization's configured, sourced reference intervals. No defaults are invented. */
  private flag(v: Record<string, any>, refs: { parameter: string; low: Prisma.Decimal; high: Prisma.Decimal; source: string }[]) {
    const flags: Record<string, { flag: Flag; low: number; high: number; source: string }> = {};
    for (const r of refs) {
      const value = v[r.parameter];
      if (value === null || value === undefined) continue;
      const n = Number(value);
      if (n < Number(r.low)) flags[r.parameter] = { flag: 'LOW', low: Number(r.low), high: Number(r.high), source: r.source };
      else if (n > Number(r.high)) flags[r.parameter] = { flag: 'HIGH', low: Number(r.low), high: Number(r.high), source: r.source };
    }
    return flags;
  }

  async recordVitals(patientId: string, encounterId: string | null, input: VitalsInput, admissionId: string | null = null) {
    const ctx = RequestContext.require();
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw notFound('Patient');
    if (encounterId) {
      const e = await this.prisma.db.encounter.findUnique({ where: { id: encounterId } });
      if (!e || e.patientId !== patientId) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation does not belong to this patient');
      if (e.status === 'CANCELLED') throw ruleViolation('ENCOUNTER_CANCELLED', 'This consultation was cancelled');
    }
    const values = Object.entries(input).filter(([k, v]) => k !== 'recordedAt' && k !== 'notes' && v !== null && v !== undefined);
    if (!values.length) throw ruleViolation('EMPTY_VITALS', 'Enter at least one measurement');
    const recordedAt = input.recordedAt ?? new Date();
    return this.prisma.db.$transaction(async (tx) => {
      const v = await tx.vitalSign.create({
        data: {
          ...input,
          recordedAt,
          organizationId: ctx.organizationId!,
          patientId,
          encounterId,
          admissionId,
          recordedById: ctx.userId,
          recordedByName: ctx.userName,
        },
      });
      // Weight measured during vitals also feeds the weight history.
      if (input.weightKg) {
        await tx.weightRecord.create({
          data: { organizationId: ctx.organizationId!, patientId, weightKg: input.weightKg, measuredAt: recordedAt, recordedById: ctx.userId, recordedByName: ctx.userName, notes: 'From vital signs' },
        });
        const latest = await tx.weightRecord.findFirst({ where: { patientId }, orderBy: { measuredAt: 'desc' } });
        await tx.patient.update({ where: { id: patientId }, data: { latestWeightKg: latest?.weightKg ?? null } });
      }
      await this.audit.record({ action: 'vitals.recorded', entityType: 'Patient', entityId: patientId, summary: values.map(([k, val]) => `${k}=${val}`).join(', ') }, tx);
      return { ...numericVitals(v), flags: this.flag(v, await this.references(patient.speciesId)) };
    });
  }

  async listVitals(patientId: string, limit = 100, admissionId?: string) {
    const patient = await this.prisma.db.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw notFound('Patient');
    const refs = await this.references(patient.speciesId);
    const rows = await this.prisma.db.vitalSign.findMany({ where: { patientId, admissionId }, orderBy: { recordedAt: 'desc' }, take: limit });
    return {
      references: refs.map((r) => ({ parameter: r.parameter, low: Number(r.low), high: Number(r.high), unit: r.unit, source: r.source })),
      vitals: rows.map((v) => ({ ...numericVitals(v), flags: this.flag(v, refs) })),
    };
  }

  // ── Diagnoses & problem list ──

  async addDiagnosis(
    encounterId: string,
    input: { term: string; codeSystem?: string | null; code?: string | null; type: DiagnosisType; status: DiagnosisStatus; notes?: string | null; addToProblemList: boolean },
  ) {
    const ctx = RequestContext.require();
    const e = await this.prisma.db.encounter.findUnique({ where: { id: encounterId } });
    if (!e) throw notFound('Encounter');
    if (e.status === 'CANCELLED') throw ruleViolation('ENCOUNTER_CANCELLED', 'This consultation was cancelled');
    const { addToProblemList, ...data } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const d = await tx.diagnosis.create({
        data: { ...data, organizationId: ctx.organizationId!, encounterId, patientId: e.patientId, diagnosedById: ctx.userId, diagnosedByName: ctx.userName },
      });
      if (addToProblemList) {
        await tx.problemListItem.create({
          data: {
            organizationId: ctx.organizationId!,
            patientId: e.patientId,
            term: input.term,
            onsetDate: new Date(),
            sourceDiagnosisId: d.id,
            createdByName: ctx.userName,
          },
        });
      }
      await this.audit.record({ action: 'diagnosis.added', entityType: 'Encounter', entityId: encounterId, summary: `${input.type}: ${input.term}` }, tx);
      return d;
    });
  }

  async updateDiagnosis(id: string, input: Partial<{ term: string; type: DiagnosisType; status: DiagnosisStatus; notes: string | null; code: string | null; codeSystem: string | null }>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.diagnosis.findUnique({ where: { id } });
      if (!before) throw notFound('Diagnosis');
      const after = await tx.diagnosis.update({ where: { id }, data: input });
      await this.audit.record(
        { action: 'diagnosis.updated', entityType: 'Encounter', entityId: before.encounterId, summary: after.term, changes: diff(before, after, Object.keys(input)) },
        tx,
      );
      return after;
    });
  }

  async patientDiagnoses(patientId: string) {
    return this.prisma.db.diagnosis.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: { encounter: { select: { id: true, number: true, startedAt: true } } },
      take: 200,
    });
  }

  listProblems(patientId: string) {
    return this.prisma.db.problemListItem.findMany({ where: { patientId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  }

  async addProblem(patientId: string, input: { term: string; status: ProblemStatus; onsetDate?: Date | null; resolvedDate?: Date | null; isChronic: boolean; notes?: string | null }) {
    const ctx = RequestContext.require();
    const p = await this.prisma.db.patient.findUnique({ where: { id: patientId } });
    if (!p) throw notFound('Patient');
    return this.prisma.db.$transaction(async (tx) => {
      const item = await tx.problemListItem.create({ data: { ...input, patientId, organizationId: ctx.organizationId!, createdByName: ctx.userName } });
      await this.audit.record({ action: 'problem.added', entityType: 'Patient', entityId: patientId, summary: input.term }, tx);
      return item;
    });
  }

  async updateProblem(patientId: string, id: string, input: Partial<{ term: string; status: ProblemStatus; onsetDate: Date | null; resolvedDate: Date | null; isChronic: boolean; notes: string | null }>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.problemListItem.findFirst({ where: { id, patientId } });
      if (!before) throw notFound('Problem');
      const data = { ...input };
      if (input.status === 'RESOLVED' && !before.resolvedDate && input.resolvedDate === undefined) data.resolvedDate = new Date();
      const after = await tx.problemListItem.update({ where: { id }, data });
      await this.audit.record({ action: 'problem.updated', entityType: 'Patient', entityId: patientId, summary: after.term, changes: diff(before, after, Object.keys(data)) }, tx);
      return after;
    });
  }

  // ── Templates ──
  // A consultation template pre-fills the note and the examination checklist; for the guided consultation it also
  // carries the questions for the owner (tap answers that write the history) and diagnoses / advice to suggest.

  private readonly templateInclude = {
    questions: { orderBy: { sortOrder: 'asc' as const }, include: { answers: { orderBy: { sortOrder: 'asc' as const } } } },
  } satisfies Prisma.ClinicalTemplateInclude;

  /** Replaces a template's questions (and their answers) with the ones given, in that order. */
  private async writeQuestions(tx: ScopedTx, organizationId: string, templateId: string, questions: z.output<typeof templateQuestionSchema>[]) {
    await tx.templateQuestion.deleteMany({ where: { templateId } });
    for (const [i, q] of questions.entries()) {
      const question = await tx.templateQuestion.create({ data: { organizationId, templateId, ask: q.ask, multi: q.multi, sortOrder: (i + 1) * 10 } });
      await tx.templateAnswer.createMany({ data: q.answers.map((a, j) => ({ organizationId, questionId: question.id, label: a.label, text: a.text, sortOrder: (j + 1) * 10 })) });
    }
  }

  /**
   * Gives the clinic the starter questions: each set goes onto the clinic's template of the same name (or alias) when
   * that template has no questions yet, otherwise it becomes a new template. Templates already set up are untouched.
   */
  private async addStarterQuestions(tx: ScopedTx, organizationId: string) {
    const existing = await tx.clinicalTemplate.findMany({ include: { _count: { select: { questions: true } } } });
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    let added = 0;
    for (const st of STARTER_TEMPLATE_QUESTIONS) {
      const questions = st.questions.map((q) => templateQuestionSchema.parse(q));
      const match = [st.name, ...(st.aliases ?? [])].map((n) => byName.get(n.toLowerCase())).find(Boolean);
      if (match) {
        if (match._count.questions > 0) continue;
        await tx.clinicalTemplate.update({
          where: { id: match.id },
          data: {
            ...(match.icon === 'file' && { icon: st.icon }),
            ...(!match.diagnoses.length && { diagnoses: st.diagnoses ?? [] }),
            ...(!match.advice.length && { advice: st.advice }),
            ...(!match.examSystems.length && { examSystems: st.examSystems ?? [] }),
            ...(!match.presentingComplaint && st.presentingComplaint && { presentingComplaint: st.presentingComplaint }),
          },
        });
        await this.writeQuestions(tx, organizationId, match.id, questions);
      } else {
        const t = await tx.clinicalTemplate.create({
          data: { organizationId, name: st.name, icon: st.icon, presentingComplaint: st.presentingComplaint || null, examSystems: st.examSystems ?? [], diagnoses: st.diagnoses ?? [], advice: st.advice },
        });
        await this.writeQuestions(tx, organizationId, t.id, questions);
        await this.templateCreated(tx, t);
      }
      added += 1;
    }
    return added;
  }

  /**
   * Brings a clinic's starter templates up to the current library. A starter template the clinic never changed gets
   * the improved questions, diagnoses, advice and examination list (each part only if that part is unchanged);
   * templates new in this library are added with their appointment type. Templates the clinic edited, deleted or
   * switched off stay as they are.
   */
  private async upgradeLibrary(tx: ScopedTx, organizationId: string, fromVersion: number) {
    const existing = await tx.clinicalTemplate.findMany({ include: this.templateInclude });
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    const improved: string[] = [];
    const added: string[] = [];
    for (const st of STARTER_TEMPLATE_QUESTIONS) {
      const match = [st.name, ...(st.aliases ?? [])].map((n) => byName.get(n.toLowerCase())).find(Boolean);
      if (!match) {
        // Only templates new to this library: a first-library template that is missing was removed by the clinic.
        if ((st.addedIn ?? 1) <= fromVersion) continue;
        const t = await tx.clinicalTemplate.create({
          data: { organizationId, name: st.name, icon: st.icon, presentingComplaint: st.presentingComplaint || null, examSystems: st.examSystems ?? [], diagnoses: st.diagnoses ?? [], advice: st.advice },
        });
        await this.writeQuestions(tx, organizationId, t.id, st.questions.map((x) => templateQuestionSchema.parse(x)));
        await this.templateCreated(tx, t);
        added.push(st.name);
        continue;
      }
      const v1 = STARTER_V1_FINGERPRINTS[st.name];
      // A part is replaced when it is empty or still exactly the first library's, and the new one is different.
      const replace = (list: string[], next: string[], fp?: string) => (!list.length || (!!fp && listFingerprint(list) === fp)) && listFingerprint(list) !== listFingerprint(next);
      const data: Prisma.ClinicalTemplateUpdateInput = {
        ...(match.icon === 'file' && { icon: st.icon }),
        ...(!match.presentingComplaint && st.presentingComplaint && { presentingComplaint: st.presentingComplaint }),
        ...(replace(match.diagnoses, st.diagnoses ?? [], v1?.diagnoses) && { diagnoses: st.diagnoses ?? [] }),
        ...(replace(match.advice, st.advice, v1?.advice) && { advice: st.advice }),
        ...(replace(match.examSystems, st.examSystems ?? [], v1?.examSystems) && { examSystems: st.examSystems ?? [] }),
      };
      const questions = st.questions.map((x) => templateQuestionSchema.parse(x));
      const newQuestions = (!match.questions.length || (!!v1 && questionsFingerprint(match.questions) === v1.questions)) && questionsFingerprint(match.questions) !== questionsFingerprint(questions);
      if (newQuestions) await this.writeQuestions(tx, organizationId, match.id, questions);
      if (Object.keys(data).length) await tx.clinicalTemplate.update({ where: { id: match.id }, data });
      if (newQuestions || Object.keys(data).length) improved.push(match.name);
    }
    if (improved.length || added.length) {
      await this.audit.record(
        {
          action: 'template.library_updated',
          entityType: 'ClinicalTemplate',
          entityId: organizationId,
          summary: [improved.length && `Improved: ${improved.join(', ')}`, added.length && `Added: ${added.join(', ')}`].filter(Boolean).join('. '),
        },
        tx,
      );
    }
    return { improved, added };
  }

  /**
   * Adds the starter templates the first time, and later library improvements once — even if two requests arrive
   * together.
   */
  private async ensureTemplateQuestions() {
    const orgId = RequestContext.orgId();
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId }, select: { templateQuestionsSeeded: true, templateLibraryVersion: true } });
    if (!org || (org.templateQuestionsSeeded && org.templateLibraryVersion >= TEMPLATE_LIBRARY_VERSION)) return;
    await this.prisma.db.$transaction(async (tx) => {
      if (!org.templateQuestionsSeeded) {
        const claimed = await tx.organization.updateMany({ where: { id: orgId, templateQuestionsSeeded: false }, data: { templateQuestionsSeeded: true, templateLibraryVersion: TEMPLATE_LIBRARY_VERSION } });
        if (claimed.count) await this.addStarterQuestions(tx, orgId);
        return;
      }
      const claimed = await tx.organization.updateMany({ where: { id: orgId, templateLibraryVersion: { lt: TEMPLATE_LIBRARY_VERSION } }, data: { templateLibraryVersion: TEMPLATE_LIBRARY_VERSION } });
      if (claimed.count) await this.upgradeLibrary(tx, orgId, org.templateLibraryVersion);
    });
  }

  async listTemplates(includeInactive = false) {
    await this.ensureTemplateQuestions();
    return this.prisma.db.clinicalTemplate.findMany({ where: includeInactive ? {} : { isActive: true }, include: this.templateInclude, orderBy: { name: 'asc' } });
  }

  async saveTemplate(id: string | null, input: z.output<typeof clinicalTemplateSchema>) {
    const { questions, ...fields } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const orgId = RequestContext.orgId();
      const clash = await tx.clinicalTemplate.findFirst({ where: { name: { equals: fields.name, mode: 'insensitive' }, ...(id && { NOT: { id } }) } });
      if (clash) throw ruleViolation('DUPLICATE_TEMPLATE', 'A template with that name already exists');
      const data = { ...fields, examSystems: [...new Set(fields.examSystems.map((x) => x.trim()).filter(Boolean))], ...(fields.diagnoses && { diagnoses: [...new Set(fields.diagnoses)] }), ...(fields.advice && { advice: [...new Set(fields.advice)] }) };
      if (id) {
        const before = await tx.clinicalTemplate.findUnique({ where: { id }, include: this.templateInclude });
        if (!before) throw notFound('Template');
        await tx.clinicalTemplate.update({ where: { id }, data });
        // Questions are replaced only when sent, so older screens that do not know about them leave them alone.
        if (questions) await this.writeQuestions(tx, orgId, id, questions);
        const after = await tx.clinicalTemplate.findUniqueOrThrow({ where: { id }, include: this.templateInclude });
        const view = (t: typeof after) => ({ ...t, questions: t.questions.map((q) => `${q.ask} [${q.answers.map((a) => a.label).join(' / ')}]`) });
        await this.audit.record(
          { action: 'template.updated', entityType: 'ClinicalTemplate', entityId: id, summary: after.name, changes: diff(view(before), view(after), ['name', 'speciesCategory', 'presentingComplaint', 'subjective', 'objective', 'assessment', 'plan', 'examSystems', 'isActive', 'icon', 'diagnoses', 'advice', 'questions']) },
          tx,
        );
        return after;
      }
      const t = await tx.clinicalTemplate.create({ data: { ...data, organizationId: orgId } });
      if (questions?.length) await this.writeQuestions(tx, orgId, t.id, questions);
      await this.templateCreated(tx, t);
      await this.audit.record({ action: 'template.created', entityType: 'ClinicalTemplate', entityId: t.id, summary: `${t.name}${questions?.length ? ` (${questions.length} questions)` : ''}` }, tx);
      return tx.clinicalTemplate.findUniqueOrThrow({ where: { id: t.id }, include: this.templateInclude });
    });
  }

  /** Puts back the starter questions on templates that have none, and any starter template that was removed. */
  async restoreStarterQuestions() {
    await this.ensureTemplateQuestions();
    return this.prisma.db.$transaction(async (tx) => {
      const added = await this.addStarterQuestions(tx, RequestContext.orgId());
      await this.audit.record({ action: 'template.starter_restored', entityType: 'ClinicalTemplate', entityId: RequestContext.orgId(), summary: `Starter questions added to ${added} templates` }, tx);
      return { added };
    });
  }

  // ── Vital references ──

  listReferences(speciesId?: string) {
    return this.prisma.db.vitalReference.findMany({ where: { speciesId }, include: { species: { select: { name: true } } }, orderBy: [{ speciesId: 'asc' }, { parameter: 'asc' }] });
  }

  async saveReference(input: { speciesId: string; parameter: string; low: number; high: number; unit: string; source: string }) {
    const species = await this.prisma.db.species.findUnique({ where: { id: input.speciesId } });
    if (!species) throw ruleViolation('INVALID_SPECIES', 'Species not found');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const existing = await tx.vitalReference.findFirst({ where: { speciesId: input.speciesId, parameter: input.parameter } });
      const data = { ...input, reviewedByName: ctx.userName, reviewedAt: new Date() };
      const r = existing
        ? await tx.vitalReference.update({ where: { id: existing.id }, data })
        : await tx.vitalReference.create({ data: { ...data, organizationId: ctx.organizationId! } });
      await this.audit.record(
        {
          action: 'vital_reference.saved',
          entityType: 'Species',
          entityId: input.speciesId,
          summary: `${species.name} ${input.parameter} ${input.low}–${input.high} ${input.unit} (${input.source})`,
          changes: existing ? diff(existing, r, ['low', 'high', 'unit', 'source']) : undefined,
        },
        tx,
      );
      return r;
    });
  }

  async removeReference(id: string) {
    const r = await this.prisma.db.vitalReference.findUnique({ where: { id } });
    if (!r) throw notFound('Reference');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.vitalReference.delete({ where: { id } });
      await this.audit.record({ action: 'vital_reference.removed', entityType: 'Species', entityId: r.speciesId, summary: r.parameter }, tx);
    });
  }

  // ── Tasks ──

  async listTasks(q: { page: number; pageSize: number; status: string; mine?: boolean; patientId?: string; overdue?: boolean; q?: string }) {
    const ctx = RequestContext.require();
    const where: Prisma.TaskWhereInput = {
      status: q.status === 'ALL' ? undefined : (q.status as any),
      assigneeId: q.mine ? ctx.membershipId : undefined,
      patientId: q.patientId,
      dueAt: q.overdue ? { lt: new Date() } : undefined,
      title: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.task.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true } },
          assignee: { select: { id: true, user: { select: { name: true } } } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.db.task.count({ where }),
    ]);
    return paginated(rows.map((t) => ({ ...t, assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.user.name } : null })), total, q);
  }

  async createTask(input: { type: TaskType; title: string; details?: string | null; dueAt: Date; patientId?: string | null; clientId?: string | null; encounterId?: string | null; assigneeId?: string | null }) {
    const ctx = RequestContext.require();
    if (input.patientId && !(await this.prisma.db.patient.findUnique({ where: { id: input.patientId } }))) throw ruleViolation('INVALID_PATIENT', 'Patient not found');
    if (input.clientId && !(await this.prisma.db.client.findUnique({ where: { id: input.clientId } }))) throw ruleViolation('INVALID_CLIENT', 'Client not found');
    if (input.encounterId && !(await this.prisma.db.encounter.findUnique({ where: { id: input.encounterId } }))) throw ruleViolation('INVALID_ENCOUNTER', 'Consultation not found');
    if (input.assigneeId) {
      const m = await this.prisma.db.membership.findUnique({ where: { id: input.assigneeId } });
      if (!m || m.status !== 'ACTIVE') throw ruleViolation('INVALID_ASSIGNEE', 'Assignee is not an active staff member');
    }
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.task.create({
        data: { ...input, organizationId: ctx.organizationId!, branchId: ctx.branchId ?? null, createdById: ctx.userId, createdByName: ctx.userName },
      });
      await this.audit.record({ action: 'task.created', entityType: 'Task', entityId: t.id, summary: t.title }, tx);
      return t;
    });
  }

  async setTaskStatus(id: string, status: 'OPEN' | 'DONE' | 'CANCELLED') {
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const t = await tx.task.findUnique({ where: { id } });
      if (!t) throw notFound('Task');
      const after = await tx.task.update({
        where: { id },
        data: { status, completedAt: status === 'DONE' ? new Date() : null, completedByName: status === 'DONE' ? ctx.userName : null },
      });
      await this.audit.record({ action: `task.${status.toLowerCase()}`, entityType: 'Task', entityId: id, summary: t.title }, tx);
      return after;
    });
  }
}
