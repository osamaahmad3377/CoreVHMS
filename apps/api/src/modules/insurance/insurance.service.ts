import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { claimDecisionSchema, claimSchema, insuranceProviderSchema, policySchema, preAuthDecisionSchema, preAuthSchema, updateClaimSchema, updatePolicySchema } from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ScopedTx } from '../../common/prisma/tenant-extension';
import { branchToday } from '../../common/time/branch-timezone';
import { PaymentsService } from '../billing/payments.service';
import { ClinicalSummaryService } from './clinical-summary.service';

export const claimNo = (n: number) => formatNumber('CLM', n, 5);
export const preAuthNo = (n: number) => formatNumber('PA', n, 5);
/** Normalises a date-only input (yyyy-MM-dd, parsed as UTC midnight). For "today" use `branchToday`. */
const dateOnly = (d: Date) => new Date(d.toISOString().slice(0, 10));
const OPEN_CLAIM = ['DRAFT', 'SUBMITTED', 'QUERIED', 'APPROVED', 'PARTIALLY_APPROVED', 'PAID', 'CLOSED'] as const;

const policyInclude = {
  provider: { select: { id: true, name: true, phone: true, email: true, claimsEmail: true } },
  patient: { select: { id: true, name: true, number: true, species: { select: { name: true } } } },
  client: { select: { id: true, displayName: true } },
} satisfies Prisma.InsurancePolicyInclude;

/** `today` is the branch-local calendar date, so a policy does not lapse or start a day early near midnight. */
function policyState(p: { status: string; startDate: Date; endDate: Date | null }, today: Date) {
  if (p.status !== 'ACTIVE') return p.status;
  if (p.endDate && p.endDate < today) return 'EXPIRED';
  if (p.startDate > today) return 'NOT_STARTED';
  return 'ACTIVE';
}

const claimInclude = {
  policy: { include: { provider: { select: { id: true, name: true, phone: true, email: true, claimsEmail: true } } } },
  patient: { select: { id: true, name: true, number: true, sex: true, dateOfBirth: true, species: { select: { name: true } }, breed: { select: { name: true } }, breedText: true, identifiers: { where: { type: 'MICROCHIP' }, select: { value: true } } } },
  client: { select: { id: true, displayName: true, mobilePhone: true, email: true } },
  invoices: { include: { invoice: { select: { id: true, number: true, status: true, issuedAt: true, totalMinor: true, balanceMinor: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.InsuranceClaimInclude;
type Claim = Prisma.InsuranceClaimGetPayload<{ include: typeof claimInclude }>;
const shapeClaim = (c: Claim) => ({ ...c, claimNo: claimNo(c.number), outstandingMinor: Math.max(0, (c.approvedMinor ?? 0) - c.paidMinor) });

/** Insurance providers, policies, pre-authorisations and claims (with insurer payments posted to invoices). */
@Injectable()
export class InsuranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly payments: PaymentsService,
    private readonly summaries: ClinicalSummaryService,
  ) {}

  // ── Providers ──

  providers(all = false) {
    return this.prisma.db.insuranceProvider.findMany({ where: { isActive: all ? undefined : true }, orderBy: { name: 'asc' } });
  }

  async createProvider(input: z.infer<typeof insuranceProviderSchema>) {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const p = await tx.insuranceProvider.create({ data: { ...input, organizationId: RequestContext.orgId() } });
        await this.audit.record({ action: 'insurance_provider.created', entityType: 'InsuranceProvider', entityId: p.id, summary: p.name }, tx);
        return p;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('An insurer with this name already exists');
      throw e;
    }
  }

  async updateProvider(id: string, input: Partial<z.infer<typeof insuranceProviderSchema>>) {
    const before = await this.prisma.db.insuranceProvider.findUnique({ where: { id } });
    if (!before) throw notFound('Insurer');
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const after = await tx.insuranceProvider.update({ where: { id }, data: input });
        await this.audit.record({ action: 'insurance_provider.updated', entityType: 'InsuranceProvider', entityId: id, changes: diff(before, after, Object.keys(input)) }, tx);
        return after;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('An insurer with this name already exists');
      throw e;
    }
  }

  // ── Policies ──

  async policies(q: { patientId?: string; clientId?: string; providerId?: string }) {
    const rows = await this.prisma.db.insurancePolicy.findMany({ where: { patientId: q.patientId, clientId: q.clientId, providerId: q.providerId }, include: policyInclude, orderBy: [{ startDate: 'desc' }], take: 300 });
    const today = await branchToday(this.prisma);
    return rows.map((p) => ({ ...p, state: policyState(p, today) }));
  }

  async createPolicy(input: z.infer<typeof policySchema>) {
    const provider = await this.prisma.db.insuranceProvider.findUnique({ where: { id: input.providerId } });
    if (!provider || !provider.isActive) throw ruleViolation('INVALID_PROVIDER', 'Insurer not found or inactive');
    const patient = await this.prisma.db.patient.findUnique({ where: { id: input.patientId }, include: { ownerships: { where: { endedAt: null, isPrimary: true } } } });
    if (!patient || patient.status === 'MERGED') throw ruleViolation('INVALID_PATIENT', 'Animal not found');
    const owner = patient.ownerships[0];
    if (!owner) throw ruleViolation('NO_OWNER', 'This animal has no current owner');
    const ctx = RequestContext.require();
    const today = await branchToday(this.prisma);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const p = await tx.insurancePolicy.create({ data: { ...input, startDate: dateOnly(input.startDate), endDate: input.endDate ? dateOnly(input.endDate) : null, organizationId: ctx.organizationId!, clientId: owner.clientId, createdByName: ctx.userName }, include: policyInclude });
        await this.audit.record({ action: 'insurance_policy.created', entityType: 'Patient', entityId: patient.id, summary: `${provider.name} ${p.policyNumber}` }, tx);
        return { ...p, state: policyState(p, today) };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This policy number is already recorded for this insurer');
      throw e;
    }
  }

  async updatePolicy(id: string, input: z.infer<typeof updatePolicySchema>) {
    const before = await this.prisma.db.insurancePolicy.findUnique({ where: { id } });
    if (!before) throw notFound('Policy');
    if (input.endDate && input.endDate < before.startDate) throw ruleViolation('INVALID_DATES', 'End date must be after the start date');
    const today = await branchToday(this.prisma);
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.insurancePolicy.update({ where: { id }, data: { ...input, endDate: input.endDate ? dateOnly(input.endDate) : input.endDate }, include: policyInclude });
      await this.audit.record({ action: 'insurance_policy.updated', entityType: 'Patient', entityId: before.patientId, summary: before.policyNumber, changes: diff(before, after, Object.keys(input)) }, tx);
      return { ...after, state: policyState(after, today) };
    });
  }

  private async policy(id: string) {
    const p = await this.prisma.db.insurancePolicy.findUnique({ where: { id }, include: { provider: true } });
    if (!p) throw notFound('Policy');
    return p;
  }

  // ── Pre-authorisations ──

  async preAuths(q: { policyId?: string; patientId?: string; status?: string }) {
    const rows = await this.prisma.db.preAuthorization.findMany({
      where: { policyId: q.policyId, policy: q.patientId ? { patientId: q.patientId } : undefined, status: q.status ? { in: q.status.split(',') as any } : undefined },
      include: { policy: { include: policyInclude } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => ({ ...r, preAuthNo: preAuthNo(r.number) }));
  }

  async createPreAuth(input: z.infer<typeof preAuthSchema>) {
    const p = await this.policy(input.policyId);
    if (policyState(p, await branchToday(this.prisma)) !== 'ACTIVE') throw ruleViolation('POLICY_NOT_ACTIVE', 'This policy is not currently active');
    if (input.estimateId) {
      const est = await this.prisma.db.estimate.findUnique({ where: { id: input.estimateId } });
      if (!est || est.clientId !== p.clientId) throw ruleViolation('INVALID_ESTIMATE', 'The estimate must be for the same client');
    }
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'preauth');
      const r = await tx.preAuthorization.create({ data: { ...input, organizationId: ctx.organizationId!, number, createdByName: ctx.userName } });
      await this.audit.record({ action: 'preauth.created', entityType: 'Patient', entityId: p.patientId, summary: `${preAuthNo(number)} ${input.procedure}` }, tx);
      return { ...r, preAuthNo: preAuthNo(number) };
    });
  }

  async submitPreAuth(id: string) {
    const r = await this.prisma.db.preAuthorization.findUnique({ where: { id }, include: { policy: true } });
    if (!r) throw notFound('Pre-authorisation');
    if (r.status !== 'DRAFT') throw ruleViolation('NOT_DRAFT', 'Only drafts can be submitted');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.preAuthorization.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      await this.audit.record({ action: 'preauth.submitted', entityType: 'Patient', entityId: r.policy.patientId, summary: preAuthNo(r.number) }, tx);
      return { ...after, preAuthNo: preAuthNo(after.number) };
    });
  }

  async decidePreAuth(id: string, input: z.infer<typeof preAuthDecisionSchema>) {
    const r = await this.prisma.db.preAuthorization.findUnique({ where: { id }, include: { policy: true } });
    if (!r) throw notFound('Pre-authorisation');
    if (r.status !== 'SUBMITTED') throw ruleViolation('NOT_SUBMITTED', 'Record the insurer’s decision after submitting');
    if (input.approvedMinor != null && input.approvedMinor > r.estimateMinor) throw ruleViolation('OVER_ESTIMATE', 'Approved amount cannot exceed the estimate');
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.preAuthorization.update({ where: { id }, data: { status: input.decision, approvedMinor: input.decision === 'DECLINED' ? 0 : input.approvedMinor, insurerReference: input.insurerReference, decisionNotes: input.decisionNotes, decidedAt: new Date() } });
      await this.audit.record({ action: `preauth.${input.decision.toLowerCase()}`, entityType: 'Patient', entityId: r.policy.patientId, summary: preAuthNo(r.number) }, tx);
      return { ...after, preAuthNo: preAuthNo(after.number) };
    });
  }

  // ── Claims ──

  async claims(q: { status?: string; patientId?: string; clientId?: string; providerId?: string }) {
    const rows = await this.prisma.db.insuranceClaim.findMany({
      where: { status: q.status ? { in: q.status.split(',') as any } : undefined, patientId: q.patientId, clientId: q.clientId, policy: q.providerId ? { providerId: q.providerId } : undefined },
      include: claimInclude,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(shapeClaim);
  }

  async claim(id: string) {
    const c = await this.prisma.db.insuranceClaim.findUnique({ where: { id }, include: claimInclude });
    if (!c) throw notFound('Claim');
    return shapeClaim(c);
  }

  /** Everything the printable claim form needs: invoices with their lines and the clinical history in the period. */
  async claimForm(id: string) {
    const c = await this.claim(id);
    const [lines, history, org, payments] = await Promise.all([
      this.prisma.db.invoiceLine.findMany({ where: { invoiceId: { in: c.invoices.map((i) => i.invoiceId) } }, orderBy: [{ invoiceId: 'asc' }, { sortOrder: 'asc' }] }),
      this.summaries.forPeriod(c.patientId, c.treatmentFrom, new Date(c.treatmentTo.getTime() + 86400_000 - 1)),
      this.prisma.raw.organization.findUniqueOrThrow({ where: { id: RequestContext.orgId() }, select: { name: true, legalName: true, phone: true, email: true, taxNumber: true, country: true, currency: true } }),
      this.prisma.db.payment.findMany({ where: { method: 'INSURANCE', notes: { contains: claimNo(c.number) } }, select: { id: true, number: true, amountMinor: true, receivedAt: true, reference: true } }),
    ]);
    return { claim: c, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) })), history, organization: org, payments };
  }

  private async checkInvoices(clientId: string, invoices: { invoiceId: string; amountMinor?: number | null }[], exceptClaimId?: string) {
    const ids = invoices.map((i) => i.invoiceId);
    if (new Set(ids).size !== ids.length) throw ruleViolation('DUPLICATE_INVOICE', 'Each invoice can be listed once');
    const rows = await this.prisma.db.invoice.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length) throw ruleViolation('INVALID_INVOICE', 'Invoice not found');
    const out: { invoiceId: string; amountMinor: number }[] = [];
    for (const i of invoices) {
      const inv = rows.find((r) => r.id === i.invoiceId)!;
      if (inv.clientId !== clientId) throw ruleViolation('INVOICE_CLIENT', 'All invoices must belong to the policy holder');
      if (!['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status)) throw ruleViolation('INVOICE_NOT_ISSUED', 'Only issued invoices can be claimed');
      const amount = i.amountMinor ?? inv.totalMinor;
      if (amount > inv.totalMinor) throw ruleViolation('OVER_INVOICE', 'The amount claimed cannot exceed the invoice total');
      out.push({ invoiceId: inv.id, amountMinor: amount });
    }
    const elsewhere = await this.prisma.db.insuranceClaimInvoice.findFirst({ where: { invoiceId: { in: ids }, claim: { status: { in: [...OPEN_CLAIM] }, id: exceptClaimId ? { not: exceptClaimId } : undefined } }, include: { claim: { select: { number: true } } } });
    if (elsewhere) throw conflict(`An invoice is already on claim ${claimNo(elsewhere.claim.number)}`);
    return out;
  }

  async createClaim(input: z.infer<typeof claimSchema>) {
    const p = await this.policy(input.policyId);
    if (p.status === 'CANCELLED') throw ruleViolation('POLICY_CANCELLED', 'This policy was cancelled');
    if (dateOnly(input.treatmentFrom) < p.startDate || (p.endDate && dateOnly(input.treatmentFrom) > p.endDate)) throw ruleViolation('OUTSIDE_COVER', 'Treatment started outside the policy period');
    const invoices = await this.checkInvoices(p.clientId, input.invoices);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'claim');
      const c = await tx.insuranceClaim.create({
        data: {
          organizationId: ctx.organizationId!,
          number,
          policyId: p.id,
          patientId: p.patientId,
          clientId: p.clientId,
          condition: input.condition,
          treatmentFrom: dateOnly(input.treatmentFrom),
          treatmentTo: dateOnly(input.treatmentTo),
          payee: input.payee,
          clinicalSummary: input.clinicalSummary,
          notes: input.notes,
          claimedMinor: invoices.reduce((n, i) => n + i.amountMinor, 0),
          createdByName: ctx.userName,
          invoices: { create: invoices.map((i) => ({ organizationId: ctx.organizationId!, ...i })) },
        },
        include: claimInclude,
      });
      await this.audit.record({ action: 'claim.created', entityType: 'Patient', entityId: p.patientId, summary: `${claimNo(number)} ${input.condition}` }, tx);
      return shapeClaim(c);
    });
  }

  async updateClaim(id: string, input: z.infer<typeof updateClaimSchema>) {
    const before = await this.prisma.db.insuranceClaim.findUnique({ where: { id } });
    if (!before) throw notFound('Claim');
    if (!['DRAFT', 'QUERIED'].includes(before.status)) throw ruleViolation('NOT_EDITABLE', 'Only draft claims or claims queried by the insurer can be edited');
    const from = input.treatmentFrom ? dateOnly(input.treatmentFrom) : before.treatmentFrom;
    const to = input.treatmentTo ? dateOnly(input.treatmentTo) : before.treatmentTo;
    if (to < from) throw ruleViolation('INVALID_DATES', 'End of treatment must be after the start');
    const invoices = input.invoices ? await this.checkInvoices(before.clientId, input.invoices, id) : null;
    const { invoices: _i, ...fields } = input;
    return this.prisma.db.$transaction(async (tx) => {
      if (invoices) {
        await tx.insuranceClaimInvoice.deleteMany({ where: { claimId: id } });
        await tx.insuranceClaimInvoice.createMany({ data: invoices.map((i) => ({ organizationId: before.organizationId, claimId: id, ...i })) });
      }
      const after = await tx.insuranceClaim.update({
        where: { id },
        data: { ...fields, treatmentFrom: from, treatmentTo: to, ...(invoices ? { claimedMinor: invoices.reduce((n, i) => n + i.amountMinor, 0) } : {}) },
        include: claimInclude,
      });
      await this.audit.record({ action: 'claim.updated', entityType: 'Patient', entityId: before.patientId, summary: claimNo(before.number), changes: diff(before, after, [...Object.keys(fields), 'claimedMinor']) }, tx);
      return shapeClaim(after);
    });
  }

  async submitClaim(id: string) {
    const c = await this.prisma.db.insuranceClaim.findUnique({ where: { id }, include: { invoices: true } });
    if (!c) throw notFound('Claim');
    if (!['DRAFT', 'QUERIED'].includes(c.status)) throw ruleViolation('NOT_SUBMITTABLE', 'This claim has already been submitted');
    if (!c.invoices.length) throw ruleViolation('NO_INVOICES', 'Add the invoices being claimed first');
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.insuranceClaim.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedByName: ctx.userName }, include: claimInclude });
      await this.audit.record({ action: c.status === 'QUERIED' ? 'claim.resubmitted' : 'claim.submitted', entityType: 'Patient', entityId: c.patientId, summary: claimNo(c.number) }, tx);
      return shapeClaim(after);
    });
  }

  async decideClaim(id: string, input: z.infer<typeof claimDecisionSchema>) {
    const c = await this.prisma.db.insuranceClaim.findUnique({ where: { id } });
    if (!c) throw notFound('Claim');
    if (c.status !== 'SUBMITTED') throw ruleViolation('NOT_SUBMITTED', 'Record the insurer’s decision on a submitted claim');
    if (input.approvedMinor != null && input.approvedMinor > c.claimedMinor) throw ruleViolation('OVER_CLAIM', 'Approved amount cannot exceed the amount claimed');
    const approved = input.decision === 'APPROVED' || input.decision === 'PARTIALLY_APPROVED' ? input.approvedMinor! : input.decision === 'REJECTED' ? 0 : null;
    return this.prisma.db.$transaction(async (tx) => {
      const after = await tx.insuranceClaim.update({ where: { id }, data: { status: input.decision, approvedMinor: approved, insurerReference: input.insurerReference ?? c.insurerReference, decisionNotes: input.decisionNotes, decidedAt: new Date() }, include: claimInclude });
      await this.audit.record({ action: `claim.${input.decision.toLowerCase()}`, entityType: 'Patient', entityId: c.patientId, summary: `${claimNo(c.number)}${approved != null ? ` approved ${approved}` : ''}` }, tx);
      return shapeClaim(after);
    });
  }

  /**
   * Records money received from the insurer. When the clinic is the payee, it is posted as an INSURANCE
   * payment against the claimed invoices (oldest first; any excess becomes client credit), in the same
   * transaction as the claim update. When the insurer pays the client directly, only the claim is updated.
   */
  async recordPayment(id: string, input: { amountMinor: number; reference?: string | null; paidAt?: Date | null; idempotencyKey?: string }) {
    const c = await this.prisma.db.insuranceClaim.findUnique({ where: { id }, include: { invoices: { include: { invoice: true }, orderBy: { createdAt: 'asc' } } } });
    if (!c) throw notFound('Claim');
    if (!['APPROVED', 'PARTIALLY_APPROVED'].includes(c.status)) throw ruleViolation('NOT_APPROVED', 'Record payment once the insurer has approved the claim');
    const outstanding = (c.approvedMinor ?? 0) - c.paidMinor;
    if (input.amountMinor > outstanding) throw ruleViolation('OVER_APPROVED', `Only ${outstanding} remains of the approved amount`);
    const settle = async (tx: ScopedTx) => {
      const paid = c.paidMinor + input.amountMinor;
      const after = await tx.insuranceClaim.update({ where: { id }, data: { paidMinor: paid, status: paid >= (c.approvedMinor ?? 0) ? 'PAID' : c.status, paidAt: input.paidAt ?? new Date() } });
      await this.audit.record({ action: 'claim.payment_recorded', entityType: 'Patient', entityId: c.patientId, summary: `${claimNo(c.number)} ${input.amountMinor}${c.payee === 'CLIENT' ? ' (paid to client)' : ''}` }, tx);
      return after;
    };
    if (c.payee === 'CLIENT') {
      await this.prisma.db.$transaction(settle);
      return this.claim(id);
    }
    let remaining = input.amountMinor;
    const allocations: { invoiceId: string; amountMinor: number }[] = [];
    for (const ci of c.invoices) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, ci.invoice.balanceMinor, ci.amountMinor);
      if (take > 0 && ['ISSUED', 'PARTIALLY_PAID'].includes(ci.invoice.status)) {
        allocations.push({ invoiceId: ci.invoiceId, amountMinor: take });
        remaining -= take;
      }
    }
    await this.payments.take(
      { clientId: c.clientId, amountMinor: input.amountMinor, method: 'INSURANCE', reference: input.reference ?? c.insurerReference, notes: `Insurance claim ${claimNo(c.number)}`, allocations, idempotencyKey: input.idempotencyKey },
      async (tx) => {
        await settle(tx);
      },
    );
    return this.claim(id);
  }
}
