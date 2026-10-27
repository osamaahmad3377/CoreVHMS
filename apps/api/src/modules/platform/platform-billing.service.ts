import { Injectable, Logger } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import {
  PLATFORM_PAYMENT_METHOD_LABELS,
  addMonths,
  formatMoney,
  nextPeriodStart,
  receiptNumber,
  type BillingSummary,
  type RecordPaymentInput,
} from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound, ruleViolation } from '../../common/http/errors';
import { escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenancyService } from '../../common/tenancy/tenancy.service';
import { PlatformClinicsService } from './platform-clinics.service';
import { toPayment } from './platform-payments';

/** Why a clinic was paused for billing: reactivated automatically when it pays. */
const BILLING_PAUSES = ['TRIAL_ENDED', 'UNPAID'];
const day = (d: Date) => d.toISOString().slice(0, 10);
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * What clinics pay NextCore: payments recorded by the super admin (bank transfer, JazzCash, cash…), each covering a
 * number of months from the end of what was already paid — plus free months given on top, e.g. one free month for
 * paying a year upfront. Payments are never deleted; a mistake is cancelled with a reason.
 */
@Injectable()
export class PlatformBillingService {
  private readonly log = new Logger(PlatformBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tenancy: TenancyService,
    private readonly clinics: PlatformClinicsService,
  ) {}

  async list(filter: { clinicId?: string; from?: string; to?: string } = {}) {
    this.clinics.assertPlatformArea();
    const rows = await this.prisma.control.clinicPayment.findMany({
      where: {
        ...(filter.clinicId ? { tenantId: filter.clinicId } : {}),
        ...(filter.from || filter.to ? { paidAt: { ...(filter.from ? { gte: new Date(filter.from) } : {}), ...(filter.to ? { lt: new Date(filter.to) } : {}) } } : {}),
      },
      include: { tenant: { select: { name: true } } },
      orderBy: [{ paidAt: 'desc' }, { number: 'desc' }],
      take: 1000,
    });
    return rows.map(toPayment);
  }

  /** Records a payment: the clinic is paid up to the end of the new period, its free trial ends, and a pause for billing is lifted. */
  async record(clinicId: string, input: RecordPaymentInput) {
    const t = await this.clinics.findWithPlan(clinicId);
    if (!t.plan) throw ruleViolation('NO_PLAN', 'Choose a plan for this clinic first — a clinic without a plan is not charged');
    if (input.billingCycle === 'YEARLY' && t.plan.priceYearlyMinor == null) throw ruleViolation('YEARLY_NOT_OFFERED', `The ${t.plan.name} plan has no yearly price`);
    const now = new Date();
    const paidAt = new Date(input.paidAt);
    if (paidAt.getTime() > now.getTime() + 86400_000) throw ruleViolation('DATE_IN_FUTURE', 'The payment date cannot be in the future');
    const start = input.periodStart ? new Date(input.periodStart) : nextPeriodStart(t, now);
    if (input.periodStart && Math.abs(start.getTime() - now.getTime()) > 400 * 86400_000) throw ruleViolation('PERIOD_START_OUT_OF_RANGE', 'The period must start within a year of today');
    const end = addMonths(start, input.paidMonths + input.freeMonths);
    const reactivate = t.status === 'SUSPENDED' && !!t.pausedReason && BILLING_PAUSES.includes(t.pausedReason);
    const ctx = RequestContext.get();

    const payment = await this.prisma.control.$transaction(async (tx) => {
      const p = await tx.clinicPayment.create({
        data: {
          tenantId: t.id,
          planName: t.plan!.name,
          billingCycle: input.billingCycle,
          amountMinor: input.amountMinor,
          currency: t.plan!.currency,
          paidMonths: input.paidMonths,
          freeMonths: input.freeMonths,
          periodStart: start,
          periodEnd: end,
          paidAt,
          method: input.method,
          reference: input.reference ?? null,
          note: input.note ?? null,
          recordedById: ctx?.userId ?? null,
          recordedByName: ctx?.userName ?? null,
        },
        include: { tenant: { select: { name: true } } },
      });
      await tx.tenant.update({
        where: { id: t.id },
        data: {
          paidUntil: end,
          billingCycle: input.billingCycle,
          trialEndsAt: null,
          trialThenPlanId: null,
          ...(reactivate ? { status: 'ACTIVE', suspendedAt: null, pausedReason: null } : {}),
        },
      });
      const free = input.freeMonths ? ` + ${input.freeMonths} free month${input.freeMonths === 1 ? '' : 's'}` : '';
      await this.audit.record(
        {
          action: 'platform.payment_recorded',
          entityType: 'Tenant',
          entityId: t.id,
          summary: `${receiptNumber(p.number)} · ${formatMoney(input.amountMinor, p.currency)} · ${input.paidMonths} month${input.paidMonths === 1 ? '' : 's'}${free} · paid until ${day(end)}${reactivate ? ' · reactivated' : ''}`,
          organizationId: null,
        },
        tx,
      );
      if (reactivate) await this.audit.record({ action: 'platform.clinic_reactivated', entityType: 'Tenant', entityId: t.id, summary: `${t.slug}: paid`, organizationId: null }, tx);
      return p;
    });
    this.tenancy.forget(t.slug);

    const months = `${input.paidMonths} month${input.paidMonths === 1 ? '' : 's'}${input.freeMonths ? ` + ${input.freeMonths} free month${input.freeMonths === 1 ? '' : 's'}` : ''}`;
    await this.notify(
      t,
      `Payment received — receipt ${receiptNumber(payment.number)}`,
      [
        `Thank you — we have received ${formatMoney(input.amountMinor, payment.currency)} for ${t.name} (${t.plan.name} plan, ${input.billingCycle === 'YEARLY' ? 'yearly' : 'monthly'}).`,
        `It covers ${months}: ${longDate(start)} to ${longDate(end)}.`,
        `Receipt ${receiptNumber(payment.number)} · ${PLATFORM_PAYMENT_METHOD_LABELS[input.method]}${input.reference ? ` · ref ${input.reference}` : ''}.`,
      ],
    );
    return toPayment(payment);
  }

  /** Cancels a payment recorded by mistake. The clinic's "paid until" goes back to its other payments. */
  async void(paymentId: string, reason: string) {
    this.clinics.assertPlatformArea();
    const p = await this.prisma.control.clinicPayment.findUnique({ where: { id: paymentId }, include: { tenant: true } });
    if (!p) throw notFound('Payment');
    if (p.voidedAt) throw ruleViolation('ALREADY_CANCELLED', 'This payment has already been cancelled');
    const updated = await this.prisma.control.$transaction(async (tx) => {
      const v = await tx.clinicPayment.update({
        where: { id: p.id },
        data: { voidedAt: new Date(), voidedByName: RequestContext.get()?.userName ?? null, voidReason: reason },
        include: { tenant: { select: { name: true } } },
      });
      const latest = await tx.clinicPayment.findFirst({ where: { tenantId: p.tenantId, voidedAt: null }, orderBy: { periodEnd: 'desc' } });
      await tx.tenant.update({ where: { id: p.tenantId }, data: { paidUntil: latest?.periodEnd ?? null } });
      await this.audit.record(
        { action: 'platform.payment_cancelled', entityType: 'Tenant', entityId: p.tenantId, summary: `${receiptNumber(p.number)} · ${formatMoney(p.amountMinor, p.currency)} · ${reason}`, organizationId: null },
        tx,
      );
      return v;
    });
    this.tenancy.forget(p.tenant.slug);
    return toPayment(updated);
  }

  /** Emails the owner what is due and by when. */
  async remind(clinicId: string) {
    const c = await this.clinics.get(clinicId);
    const s = c.payment;
    if (!['OVERDUE', 'DUE_SOON', 'UNPAID'].includes(s.kind)) throw ruleViolation('NOTHING_DUE', 'Nothing is due from this clinic right now');
    const t = await this.clinics.findWithPlan(clinicId);
    const amount = formatMoney(s.dueMinor, s.currency);
    const period = c.bill?.periodMonths === 12 ? 'year' : 'month';
    const when =
      s.kind === 'OVERDUE' ? `was due on ${longDate(new Date(s.date!))}` : s.kind === 'DUE_SOON' ? `is due on ${longDate(new Date(s.date!))}` : 'is due now';
    await this.notify(t, `Payment ${s.kind === 'OVERDUE' ? 'overdue' : 'due'} for ${t.name}`, [
      `Your NextCore VCMS payment of ${amount} for the next ${period} (${c.planName} plan) ${when}.`,
      'Please pay by bank transfer, JazzCash or Easypaisa and send us the reference, so your clinic carries on without interruption.',
      'If you have already paid, thank you — please reply with the reference and we will update your account.',
    ]);
    await this.audit.record({ action: 'platform.payment_reminder_sent', entityType: 'Tenant', entityId: t.id, summary: `${amount} · ${t.ownerEmail}`, organizationId: null });
    return { ok: true, to: t.ownerEmail };
  }

  /** Income, what is owed and what was collected — for the super admin dashboard. */
  async summary(now = new Date()): Promise<BillingSummary> {
    const clinics = (await this.clinics.list()).filter((c) => c.status === 'ACTIVE' || c.status === 'SUSPENDED');
    const plans = await this.prisma.control.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: 1 });
    const currency = plans[0]?.currency ?? 'PKR';
    const mine = clinics.filter((c) => c.bill?.currency === currency);
    const active = mine.filter((c) => c.status === 'ACTIVE');
    const sum = (kind: string) => {
      const on = mine.filter((c) => c.payment.kind === kind);
      return { count: on.length, amountMinor: on.reduce((n, c) => n + c.payment.dueMinor, 0) };
    };
    const paying = active.filter((c) => ['PAID', 'DUE_SOON', 'OVERDUE', 'UNPAID'].includes(c.payment.kind));

    const monthStart = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const payments = await this.prisma.control.clinicPayment.findMany({
      where: { voidedAt: null, currency, paidAt: { gte: monthStart(-11) } },
      select: { amountMinor: true, paidAt: true },
    });
    const months = Array.from({ length: 12 }, (_, i) => {
      const from = monthStart(i - 11);
      const to = monthStart(i - 10);
      const inMonth = payments.filter((p) => p.paidAt >= from && p.paidAt < to);
      return { month: from.toISOString().slice(0, 7), totalMinor: inMonth.reduce((n, p) => n + p.amountMinor, 0), count: inMonth.length };
    });
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const thisYear = await this.prisma.control.clinicPayment.aggregate({ where: { voidedAt: null, currency, paidAt: { gte: yearStart } }, _sum: { amountMinor: true } });

    return {
      currency,
      mrrMinor: paying.reduce((n, c) => n + (c.bill?.totalMinor ?? 0), 0),
      payingClinics: paying.length,
      trialClinics: active.filter((c) => c.payment.kind === 'TRIAL').length,
      overdue: sum('OVERDUE'),
      dueSoon: sum('DUE_SOON'),
      unpaid: sum('UNPAID'),
      collectedThisMonthMinor: months[11].totalMinor,
      collectedLastMonthMinor: months[10].totalMinor,
      collectedThisYearMinor: thisYear._sum.amountMinor ?? 0,
      months,
    };
  }

  private async notify(t: Tenant, subject: string, lines: string[]) {
    try {
      await this.mail.send({
        to: t.ownerEmail,
        subject,
        text: `Hello ${t.ownerName},\n\n${lines.join('\n\n')}\n\nNextCore VCMS`,
        html: layout(escapeHtml(subject), `<p>Hello ${escapeHtml(t.ownerName)},</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}`),
      });
    } catch (e) {
      this.log.error(`Email to ${t.ownerEmail} failed: ${(e as Error).message}`);
    }
  }
}
