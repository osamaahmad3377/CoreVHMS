import { formatMoney, toWhatsAppNumber, type AutomationFacts, type AutomationTrigger } from '@vcms/shared';
import { formatInTimeZone } from 'date-fns-tz';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { formatNumber } from '../../common/counter/counter.service';
import { invoiceNo } from '../billing/invoices.service';
import { receiptNo } from '../billing/payments.service';

/** The clinic facts every automation message can use. */
export interface OrgInfo {
  name: string;
  phone: string | null;
  country: string;
  currency: string;
  timezone: string;
  whatsappActive: boolean;
  /** "Book online: <link>" when the clinic's booking page is on, else empty. */
  bookingLine: string;
}

export interface RunClient {
  id: string;
  displayName: string;
  email: string | null;
  mobilePhone: string | null;
  preferredChannel: string;
  status: string;
  remindersConsent: boolean;
  marketingConsent: boolean;
}

/** Everything a run needs about the record that started it. */
export interface RunContext {
  sourceType: string;
  sourceId: string;
  client: RunClient | null;
  patientId: string | null;
  branchId: string | null;
  /** The appointment's vet, for "create a task" without a named person. */
  vetMembershipId: string | null;
  vars: Record<string, string>;
  facts: AutomationFacts;
  /** Shown in the activity list ("Tiger · Tue 28 Oct 10:30"). */
  label: string;
  /** False when the record no longer calls for the automation (e.g. the appointment was cancelled meanwhile). */
  live: boolean;
  why?: string;
}

const CLIENT = { select: { id: true, displayName: true, email: true, mobilePhone: true, preferredChannel: true, status: true, remindersConsent: true, marketingConsent: true } } as const;
const PATIENT = { select: { id: true, name: true, speciesId: true, sex: true, primaryBranchId: true, dateOfBirth: true, species: { select: { name: true } } } } as const;

export const SOURCE_OF: Record<AutomationTrigger, string> = {
  APPOINTMENT_BOOKED: 'Appointment',
  APPOINTMENT_RESCHEDULED: 'Appointment',
  APPOINTMENT_CANCELLED: 'Appointment',
  APPOINTMENT_UPCOMING: 'Appointment',
  APPOINTMENT_COMPLETED: 'Appointment',
  APPOINTMENT_NO_SHOW: 'Appointment',
  LAB_RESULTS_READY: 'DiagnosticOrder',
  PATIENT_DISCHARGED: 'Admission',
  PAYMENT_RECEIVED: 'Payment',
  VACCINATION_GIVEN: 'CareItem',
  CARE_DUE: 'CareItem',
  CLIENT_REGISTERED: 'Client',
  PET_BIRTHDAY: 'Patient',
  PATIENT_ADMITTED: 'Admission',
  SURGERY_UPCOMING: 'Surgery',
  INVOICE_OVERDUE: 'Invoice',
  PATIENT_LAPSED: 'Patient',
  APPOINTMENT_CHECKED_IN: 'Appointment',
  PRESCRIPTION_DISPENSED: 'Prescription',
  SURGERY_COMPLETED: 'Surgery',
  ESTIMATE_SENT: 'Estimate',
};

const reach = (c: RunClient | null, org: OrgInfo) => ({ hasWhatsApp: !!c && org.whatsappActive && !!toWhatsAppNumber(c.mobilePhone, org.country), hasEmail: !!c?.email });
const base = (org: OrgInfo, c: RunClient | null) => ({ clientName: c?.displayName ?? '', clinicName: org.name, clinicPhone: org.phone ?? '', bookingLine: org.bookingLine });
const day = (d: Date, tz: string) => formatInTimeZone(d, tz, 'd MMM yyyy');
const dateOnly = (d: Date) => formatInTimeZone(d, 'UTC', 'd MMM yyyy');
const yearsOld = (dob: Date | null, now = new Date()) => (dob ? String(now.getUTCFullYear() - dob.getUTCFullYear()) : '');
/** Species, sex (neutered counts as its sex) and age in whole years, for conditions. */
const petFacts = (p: { speciesId: string; sex: string; dateOfBirth: Date | null } | null | undefined) =>
  p
    ? {
        speciesId: p.speciesId,
        patientSex: p.sex.startsWith('FEMALE') ? ('FEMALE' as const) : p.sex.startsWith('MALE') ? ('MALE' as const) : null,
        ageYears: p.dateOfBirth ? Math.floor((Date.now() - p.dateOfBirth.getTime()) / (365.25 * 86_400_000)) : null,
      }
    : { speciesId: null };

/** Builds the context for a trigger and record (null when the record is gone or has no client to write to). */
export async function buildContext(db: PrismaService['db'], trigger: AutomationTrigger, sourceId: string, org: OrgInfo): Promise<RunContext | null> {
  switch (SOURCE_OF[trigger]) {
    case 'Appointment': {
      const a = await db.appointment.findUnique({
        where: { id: sourceId },
        include: { client: CLIENT, patient: PATIENT, appointmentType: { select: { name: true } }, branch: { select: { name: true, timezone: true } }, clinician: { select: { id: true, user: { select: { name: true } } } } },
      });
      if (!a) return null;
      const tz = a.branch.timezone;
      // A reminder or thank-you no longer applies once the visit was cancelled or missed (and vice versa).
      const gone = ['CANCELLED', 'NO_SHOW'].includes(a.status);
      const live =
        trigger === 'APPOINTMENT_CANCELLED' ? a.status === 'CANCELLED'
        : trigger === 'APPOINTMENT_NO_SHOW' ? a.status === 'NO_SHOW'
        : trigger === 'APPOINTMENT_COMPLETED' ? a.status === 'COMPLETED'
        : !gone;
      return {
        sourceType: 'Appointment',
        sourceId: a.id,
        client: a.client,
        patientId: a.patientId,
        branchId: a.branchId,
        vetMembershipId: a.clinicianId,
        vars: {
          ...base(org, a.client),
          petName: a.patient?.name ?? 'your animal',
          species: a.patient?.species.name ?? '',
          appointmentTime: formatInTimeZone(a.startsAt, tz, 'EEE d MMM, HH:mm'),
          appointmentDate: formatInTimeZone(a.startsAt, tz, 'EEE d MMM'),
          appointmentType: a.appointmentType.name,
          branchName: a.branch.name,
          vetName: a.clinician?.user.name ?? '',
          tokenNumber: a.tokenNumber ? String(a.tokenNumber) : '',
        },
        facts: {
          ...petFacts(a.patient),
          branchId: a.branchId,
          appointmentTypeId: a.appointmentTypeId,
          source: a.source === 'ONLINE' ? 'ONLINE' : 'STAFF',
          // First visit: no other finished visit for this client.
          firstVisit: (await db.appointment.count({ where: { clientId: a.clientId, status: 'COMPLETED', id: { not: a.id } } })) === 0,
          ...reach(a.client, org),
        },
        label: `${a.patient?.name ?? a.client.displayName} · ${formatInTimeZone(a.startsAt, tz, 'EEE d MMM HH:mm')}`,
        live,
        why: live ? undefined : `The appointment is now ${a.status.toLowerCase().replace('_', '-')}`,
      };
    }
    case 'DiagnosticOrder': {
      const o = await db.diagnosticOrder.findUnique({ where: { id: sourceId }, include: { client: CLIENT, patient: PATIENT, items: { where: { status: { not: 'CANCELLED' } }, select: { test: { select: { name: true } } } } } });
      if (!o) return null;
      return {
        sourceType: 'DiagnosticOrder',
        sourceId: o.id,
        client: o.client,
        patientId: o.patientId,
        branchId: o.branchId,
        vetMembershipId: o.orderingMembershipId,
        vars: { ...base(org, o.client), petName: o.patient.name, species: o.patient.species.name, testNames: o.items.map((i) => i.test.name).join(', ') },
        facts: { ...petFacts(o.patient), branchId: o.branchId, ...reach(o.client, org) },
        label: `${o.patient.name} · ${o.items.map((i) => i.test.name).join(', ')}`,
        live: o.status === 'RELEASED',
        why: o.status === 'RELEASED' ? undefined : 'The results are no longer released',
      };
    }
    case 'Admission': {
      const a = await db.admission.findUnique({ where: { id: sourceId }, include: { client: CLIENT, patient: { select: { ...PATIENT.select, status: true } }, branch: { select: { name: true } }, responsibleClinician: { select: { user: { select: { name: true } } } } } });
      if (!a) return null;
      // Never a cheerful message about an animal that has died.
      const alive = a.patient.status === 'ACTIVE' && a.outcome !== 'DECEASED' && a.outcome !== 'EUTHANASED';
      const live = trigger === 'PATIENT_ADMITTED' ? alive && a.status !== 'CANCELLED' : alive;
      return {
        sourceType: 'Admission',
        sourceId: a.id,
        client: a.client,
        patientId: a.patientId,
        branchId: a.branchId,
        vetMembershipId: a.responsibleClinicianId,
        vars: {
          ...base(org, a.client),
          petName: a.patient.name,
          species: a.patient.species.name,
          branchName: a.branch.name,
          vetName: a.responsibleClinician?.user.name ?? '',
          homeCare: a.homeCareInstructions || 'As discussed at discharge',
          followUpDate: a.followUpAt ? day(a.followUpAt, org.timezone) : 'none booked',
        },
        facts: { ...petFacts(a.patient), branchId: a.branchId, ...reach(a.client, org) },
        label: `${a.patient.name} · ${trigger === 'PATIENT_ADMITTED' ? 'admitted' : 'discharged'}`,
        live,
        why: live ? undefined : 'The animal is no longer in a state where this applies',
      };
    }
    case 'Surgery': {
      const su = await db.surgery.findUnique({ where: { id: sourceId }, include: { client: CLIENT, patient: PATIENT, branch: { select: { name: true, timezone: true } } } });
      if (!su) return null;
      const live = trigger === 'SURGERY_COMPLETED' ? su.status === 'COMPLETED' : ['SCHEDULED', 'PRE_OP'].includes(su.status);
      return {
        sourceType: 'Surgery',
        sourceId: su.id,
        client: su.client,
        patientId: su.patientId,
        branchId: su.branchId,
        vetMembershipId: null,
        vars: {
          ...base(org, su.client),
          petName: su.patient.name,
          species: su.patient.species.name,
          procedureName: su.procedure,
          surgeryTime: formatInTimeZone(su.scheduledAt, su.branch.timezone, 'EEE d MMM, HH:mm'),
          surgeryDate: formatInTimeZone(su.scheduledAt, su.branch.timezone, 'EEE d MMM'),
          branchName: su.branch.name,
        },
        facts: { ...petFacts(su.patient), branchId: su.branchId, ...reach(su.client, org) },
        label: `${su.patient.name} · ${su.procedure} ${formatInTimeZone(su.scheduledAt, su.branch.timezone, 'EEE d MMM HH:mm')}`,
        live,
        why: live ? undefined : `The surgery is now ${su.status.toLowerCase().replace('_', ' ')}`,
      };
    }
    case 'Invoice': {
      const inv = await db.invoice.findUnique({ where: { id: sourceId }, include: { client: CLIENT } });
      if (!inv) return null;
      const live = ['ISSUED', 'PARTIALLY_PAID'].includes(inv.status) && inv.balanceMinor > 0;
      return {
        sourceType: 'Invoice',
        sourceId: inv.id,
        client: inv.client,
        patientId: inv.patientId,
        branchId: inv.branchId,
        vetMembershipId: null,
        vars: {
          ...base(org, inv.client),
          invoiceNumber: invoiceNo(inv.number),
          amountDue: formatMoney(inv.balanceMinor, org.currency),
          invoiceTotal: formatMoney(inv.totalMinor, org.currency),
          dueDate: inv.dueAt ? day(inv.dueAt, org.timezone) : '',
        },
        facts: { branchId: inv.branchId, amountMinor: inv.balanceMinor, ...reach(inv.client, org) },
        label: `${inv.client?.displayName ?? 'Invoice'} · ${invoiceNo(inv.number)} · ${formatMoney(inv.balanceMinor, org.currency)} owed`,
        live,
        why: live ? undefined : 'The invoice has been paid or voided',
      };
    }
    case 'Payment': {
      const p = await db.payment.findUnique({ where: { id: sourceId }, include: { client: { select: { ...CLIENT.select, balanceMinor: true } } } });
      if (!p) return null;
      const client = p.client ? { ...p.client } : null;
      return {
        sourceType: 'Payment',
        sourceId: p.id,
        client,
        patientId: null,
        branchId: p.branchId,
        vetMembershipId: null,
        vars: { ...base(org, client), amount: formatMoney(p.amountMinor, org.currency), receiptNumber: receiptNo(p.number), paymentDate: day(p.receivedAt, org.timezone), balance: formatMoney(Math.max(0, p.client?.balanceMinor ?? 0), org.currency) },
        facts: { branchId: p.branchId, amountMinor: p.amountMinor, ...reach(client, org) },
        label: `${client?.displayName ?? 'Walk-in sale'} · ${formatMoney(p.amountMinor, org.currency)}`,
        live: true,
      };
    }
    case 'CareItem': {
      const i = await db.careItem.findUnique({ where: { id: sourceId }, include: { patient: { select: { ...PATIENT.select, status: true, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: CLIENT } } } } } });
      if (!i) return null;
      const client = i.patient.ownerships[0]?.client ?? null;
      const next = trigger === 'VACCINATION_GIVEN' ? await db.careItem.findFirst({ where: { previousItemId: i.id, status: { in: ['DUE', 'DEFERRED'] } }, select: { dueDate: true } }) : null;
      const live = trigger === 'CARE_DUE' ? i.status === 'DUE' && i.patient.status === 'ACTIVE' : true;
      return {
        sourceType: 'CareItem',
        sourceId: i.id,
        client,
        patientId: i.patientId,
        branchId: i.patient.primaryBranchId,
        vetMembershipId: null,
        vars: {
          ...base(org, client),
          petName: i.patient.name,
          species: i.patient.species.name,
          vaccineName: i.title,
          careName: i.title,
          givenDate: day(i.completedAt ?? new Date(), org.timezone),
          nextDueDate: next ? dateOnly(next.dueDate) : 'we will let you know',
          dueDate: dateOnly(i.dueDate),
        },
        facts: { ...petFacts(i.patient), branchId: i.patient.primaryBranchId, ...reach(client, org) },
        label: `${i.patient.name} · ${i.title} ${trigger === 'CARE_DUE' ? `due ${dateOnly(i.dueDate)}` : ''}`.trim(),
        live,
        why: live ? undefined : 'It is no longer due (done, cancelled or deferred)',
      };
    }
    case 'Prescription': {
      const rx = await db.prescription.findUnique({ where: { id: sourceId }, include: { client: CLIENT, patient: PATIENT, items: { select: { product: { select: { name: true } } } } } });
      if (!rx) return null;
      const meds = [...new Set(rx.items.map((it) => it.product.name))].join(', ');
      return {
        sourceType: 'Prescription',
        sourceId: rx.id,
        client: rx.client,
        patientId: rx.patientId,
        branchId: rx.branchId,
        vetMembershipId: rx.prescriberId,
        vars: { ...base(org, rx.client), petName: rx.patient.name, species: rx.patient.species.name, medicines: meds },
        facts: { ...petFacts(rx.patient), branchId: rx.branchId, ...reach(rx.client, org) },
        label: `${rx.patient.name} · ${meds}`,
        live: rx.status !== 'CANCELLED',
        why: rx.status !== 'CANCELLED' ? undefined : 'The prescription was cancelled',
      };
    }
    case 'Estimate': {
      const found = await db.estimate.findUnique({ where: { id: sourceId }, include: { client: CLIENT } });
      if (!found) return null;
      const es = { ...found, patient: found.patientId ? await db.patient.findUnique({ where: { id: found.patientId }, ...PATIENT }) : null };
      const live = es.status === 'SENT';
      return {
        sourceType: 'Estimate',
        sourceId: es.id,
        client: es.client,
        patientId: es.patientId,
        branchId: es.branchId,
        vetMembershipId: null,
        vars: { ...base(org, es.client), petName: es.patient?.name ?? 'your animal', estimateNumber: formatNumber('EST', es.number), estimateTotal: formatMoney(es.totalMinor, org.currency), validUntil: es.validUntil ? dateOnly(es.validUntil) : 'ask us' },
        facts: { ...petFacts(es.patient), branchId: es.branchId, amountMinor: es.totalMinor, ...reach(es.client, org) },
        label: `${es.client.displayName} · ${formatNumber('EST', es.number)} · ${formatMoney(es.totalMinor, org.currency)}`,
        live,
        why: live ? undefined : 'The client has answered the estimate',
      };
    }
    case 'Client': {
      const c = await db.client.findUnique({ where: { id: sourceId }, select: { ...CLIENT.select, primaryBranchId: true } });
      if (!c) return null;
      return { sourceType: 'Client', sourceId: c.id, client: c, patientId: null, branchId: c.primaryBranchId, vetMembershipId: null, vars: base(org, c), facts: { branchId: c.primaryBranchId, ...reach(c, org) }, label: c.displayName, live: c.status === 'ACTIVE' };
    }
    case 'Patient': {
      const p = await db.patient.findUnique({ where: { id: sourceId }, select: { ...PATIENT.select, status: true, ownerships: { where: { endedAt: null, isPrimary: true }, select: { client: CLIENT } } } });
      if (!p) return null;
      const client = p.ownerships[0]?.client ?? null;
      const last = trigger === 'PATIENT_LAPSED' ? await db.appointment.findFirst({ where: { patientId: p.id, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }) : null;
      const months = last ? Math.max(0, Math.round((Date.now() - last.startsAt.getTime()) / (30.44 * 86_400_000))) : 0;
      return {
        sourceType: 'Patient',
        sourceId: p.id,
        client,
        patientId: p.id,
        branchId: p.primaryBranchId,
        vetMembershipId: null,
        vars: { ...base(org, client), petName: p.name, species: p.species.name, age: yearsOld(p.dateOfBirth), lastVisitDate: last ? day(last.startsAt, org.timezone) : '', monthsSince: String(months) },
        facts: { ...petFacts(p), branchId: p.primaryBranchId, ...reach(client, org) },
        label: trigger === 'PATIENT_LAPSED' ? `${p.name} · last seen ${last ? day(last.startsAt, org.timezone) : 'never'}` : `${p.name} · birthday`,
        live: p.status === 'ACTIVE',
        why: p.status === 'ACTIVE' ? undefined : `The animal is ${p.status.toLowerCase()}`,
      };
    }
  }
  return null;
}
