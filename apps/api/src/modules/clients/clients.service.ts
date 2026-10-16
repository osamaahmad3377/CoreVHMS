import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AddressInput,
  ClientContactInput,
  ClientListQuery,
  CreateClientInput,
  UpdateClientInput,
} from '@vcms/shared';
import { AuditService, diff } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { CounterService, formatNumber } from '../../common/counter/counter.service';
import { notFound, ruleViolation } from '../../common/http/errors';
import { orderBy, pageArgs, paginated } from '../../common/http/pagination';
import { csvCell } from '../../common/util/csv';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientMergeService } from './client-merge.service';

export const clientNo = (n: number) => formatNumber('C', n);

/** Last 10 digits — matches local (0300…) and international (+92 300…) forms of the same number. */
export function phoneKey(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-10) : null;
}

export function displayNameFor(c: {
  type?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
}): string {
  const isOrg = c.type && !['INDIVIDUAL', 'FAMILY'].includes(c.type);
  if (isOrg && c.organizationName) return c.organizationName;
  if (c.lastName && c.firstName) return `${c.lastName}, ${c.firstName}`;
  return c.lastName || c.organizationName || c.firstName || 'Unnamed client';
}

const NAME_FIELDS = ['type', 'firstName', 'lastName', 'organizationName'] as const;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly merger: ClientMergeService,
  ) {}

  async list(q: ClientListQuery) {
    const where: Prisma.ClientWhereInput = {
      status: q.status === 'ALL' ? { not: 'MERGED' } : q.status,
      type: q.type,
      primaryBranchId: q.branchId,
      balanceMinor: q.hasBalance ? { gt: 0 } : undefined,
    };
    if (q.q) where.OR = this.searchClauses(q.q);
    const [rows, total] = await Promise.all([
      this.prisma.db.client.findMany({
        where,
        ...pageArgs(q),
        orderBy: orderBy(q.sort, ['displayName', 'number', 'createdAt', 'balanceMinor'], { displayName: 'asc' }),
        include: {
          ownerships: {
            where: { endedAt: null },
            include: { patient: { select: { id: true, name: true, status: true, species: { select: { name: true } } } } },
          },
        },
      }),
      this.prisma.db.client.count({ where }),
    ]);
    return paginated(
      rows.map((c) => ({
        id: c.id,
        number: c.number,
        clientNo: clientNo(c.number),
        type: c.type,
        status: c.status,
        displayName: c.displayName,
        email: c.email,
        mobilePhone: c.mobilePhone,
        balanceMinor: c.balanceMinor,
        createdAt: c.createdAt,
        patients: c.ownerships
          .filter((o) => o.patient.status !== 'MERGED')
          .map((o) => ({ id: o.patient.id, name: o.patient.name, species: o.patient.species.name, status: o.patient.status })),
      })),
      total,
      q,
    );
  }

  searchClauses(term: string): Prisma.ClientWhereInput[] {
    const t = term.trim();
    const clauses: Prisma.ClientWhereInput[] = [
      { displayName: { contains: t, mode: 'insensitive' } },
      { firstName: { contains: t, mode: 'insensitive' } },
      { organizationName: { contains: t, mode: 'insensitive' } },
      { email: { contains: t, mode: 'insensitive' } },
    ];
    const digits = t.replace(/\D/g, '');
    if (digits.length >= 4) clauses.push({ phoneDigits: { contains: digits.slice(-10) } });
    const num = /^c-?0*(\d+)$/i.exec(t) ?? (/^\d{1,9}$/.test(t) ? [t, t] : null);
    if (num) clauses.push({ number: Number(num[1]) });
    return clauses;
  }

  async get(id: string) {
    const c = await this.prisma.db.client.findUnique({
      where: { id },
      include: {
        addresses: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        contacts: { orderBy: { createdAt: 'asc' } },
        clientNotes: { orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 50 },
        ownerships: {
          where: { endedAt: null },
          include: {
            patient: {
              include: {
                species: { select: { name: true } },
                breed: { select: { name: true } },
                alerts: { where: { isActive: true }, select: { id: true, severity: true, title: true, type: true } },
              },
            },
          },
          orderBy: { startedAt: 'asc' },
        },
      },
    });
    if (!c) throw notFound('Client');
    const mergedInto = c.mergedIntoId
      ? await this.prisma.db.client.findUnique({ where: { id: c.mergedIntoId }, select: { id: true, displayName: true } })
      : null;
    return {
      ...c,
      clientNo: clientNo(c.number),
      mergedInto,
      patients: c.ownerships
        .filter((o) => o.patient.status !== 'MERGED')
        .map((o) => ({
          id: o.patient.id,
          name: o.patient.name,
          number: o.patient.number,
          species: o.patient.species.name,
          breed: o.patient.breed?.name ?? o.patient.breedText,
          sex: o.patient.sex,
          dateOfBirth: o.patient.dateOfBirth,
          status: o.patient.status,
          isPrimaryOwner: o.isPrimary,
          alerts: o.patient.alerts,
        })),
      ownerships: undefined,
    };
  }

  private async assertBranch(branchId?: string | null) {
    if (!branchId) return;
    const b = await this.prisma.db.branch.findUnique({ where: { id: branchId } });
    if (!b) throw ruleViolation('INVALID_BRANCH', 'Branch does not exist');
  }

  async create(input: CreateClientInput) {
    await this.assertBranch(input.primaryBranchId);
    const ctx = RequestContext.require();
    const { address, ...data } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const number = await this.counters.next(tx, 'client');
      const client = await tx.client.create({
        data: {
          ...data,
          organizationId: ctx.organizationId!,
          number,
          displayName: displayNameFor(data),
          phoneDigits: phoneKey(data.mobilePhone),
          primaryBranchId: data.primaryBranchId ?? ctx.branchId ?? null,
          consentUpdatedAt: new Date(),
          createdById: ctx.userId,
          addresses: address
            ? { create: [{ ...address, isPrimary: true, organizationId: ctx.organizationId! }] }
            : undefined,
        },
      });
      await this.audit.record(
        { action: 'client.created', entityType: 'Client', entityId: client.id, summary: `${clientNo(number)} ${client.displayName}` },
        tx,
      );
      return { ...client, clientNo: clientNo(number) };
    });
  }

  async update(id: string, input: UpdateClientInput) {
    await this.assertBranch(input.primaryBranchId);
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.client.findUnique({ where: { id } });
      if (!before) throw notFound('Client');
      if (before.status === 'MERGED') throw ruleViolation('CLIENT_MERGED', 'This client was merged into another record');
      const data: Prisma.ClientUncheckedUpdateInput = { ...input };
      if (NAME_FIELDS.some((f) => input[f] !== undefined)) {
        data.displayName = displayNameFor({ ...before, ...stripUndefined(input) });
      }
      if (input.mobilePhone !== undefined) data.phoneDigits = phoneKey(input.mobilePhone);
      if (
        (input.marketingConsent !== undefined && input.marketingConsent !== before.marketingConsent) ||
        (input.remindersConsent !== undefined && input.remindersConsent !== before.remindersConsent)
      ) {
        data.consentUpdatedAt = new Date();
      }
      const after = await tx.client.update({ where: { id }, data });
      await this.audit.record(
        {
          action: 'client.updated',
          entityType: 'Client',
          entityId: id,
          summary: after.displayName,
          changes: diff(before, after, Object.keys(input)),
        },
        tx,
      );
      return after;
    });
  }

  async archive(id: string, reason: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.client.findUnique({ where: { id } });
      if (!c) throw notFound('Client');
      if (c.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'Only active clients can be archived');
      if (c.balanceMinor !== 0) {
        throw ruleViolation('OUTSTANDING_BALANCE', 'Settle or write off the outstanding balance before archiving');
      }
      const updated = await tx.client.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date(), archivedReason: reason } });
      await this.audit.record({ action: 'client.archived', entityType: 'Client', entityId: id, summary: reason }, tx);
      return updated;
    });
  }

  async restore(id: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.client.findUnique({ where: { id } });
      if (!c) throw notFound('Client');
      if (c.status !== 'ARCHIVED') throw ruleViolation('NOT_ARCHIVED', 'Only archived clients can be restored');
      const updated = await tx.client.update({ where: { id }, data: { status: 'ACTIVE', archivedAt: null, archivedReason: null } });
      await this.audit.record({ action: 'client.restored', entityType: 'Client', entityId: id }, tx);
      return updated;
    });
  }

  /** Possible duplicates by phone, email or similar name (pg_trgm similarity). */
  async findDuplicates(input: {
    firstName?: string;
    lastName?: string;
    organizationName?: string;
    email?: string;
    mobilePhone?: string;
    excludeId?: string;
  }) {
    const orgId = RequestContext.orgId();
    const results = new Map<string, { id: string; displayName: string; clientNo: string; reasons: string[] }>();
    const add = (c: { id: string; displayName: string; number: number }, reason: string) => {
      if (c.id === input.excludeId) return;
      const r = results.get(c.id) ?? { id: c.id, displayName: c.displayName, clientNo: clientNo(c.number), reasons: [] };
      if (!r.reasons.includes(reason)) r.reasons.push(reason);
      results.set(c.id, r);
    };
    const key = phoneKey(input.mobilePhone);
    if (key) {
      const rows = await this.prisma.db.client.findMany({ where: { phoneDigits: key, status: { not: 'MERGED' } }, take: 10 });
      rows.forEach((c) => add(c, 'Same mobile number'));
    }
    if (input.email) {
      const rows = await this.prisma.db.client.findMany({
        where: { email: { equals: input.email.trim(), mode: 'insensitive' }, status: { not: 'MERGED' } },
        take: 10,
      });
      rows.forEach((c) => add(c, 'Same email'));
    }
    const name = displayNameFor({
      type: input.organizationName && !input.lastName ? 'COMPANY' : 'INDIVIDUAL',
      ...input,
    });
    if (name && name !== 'Unnamed client' && name.length >= 3) {
      const rows = await this.prisma.raw.$queryRaw<{ id: string; displayName: string; number: number }[]>`
        SELECT id, "displayName", number FROM "Client"
        WHERE "organizationId" = ${orgId}::uuid AND status <> 'MERGED' AND similarity("displayName", ${name}) > 0.55
        ORDER BY similarity("displayName", ${name}) DESC LIMIT 10`;
      rows.forEach((c) => add(c, 'Similar name'));
    }
    return [...results.values()];
  }

  merge(survivorId: string, mergedId: string, reason: string) {
    return this.merger.merge(survivorId, mergedId, reason);
  }

  // ── Addresses ──
  async addAddress(clientId: string, input: AddressInput) {
    await this.mustExist(clientId);
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.address.updateMany({ where: { clientId }, data: { isPrimary: false } });
      const hasAny = await tx.address.count({ where: { clientId } });
      const a = await tx.address.create({
        data: { ...input, isPrimary: input.isPrimary || hasAny === 0, clientId, organizationId: RequestContext.orgId() },
      });
      await this.audit.record({ action: 'client.address_added', entityType: 'Client', entityId: clientId }, tx);
      return a;
    });
  }

  async updateAddress(clientId: string, addressId: string, input: Partial<AddressInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.address.findFirst({ where: { id: addressId, clientId } });
      if (!before) throw notFound('Address');
      if (input.isPrimary) await tx.address.updateMany({ where: { clientId, id: { not: addressId } }, data: { isPrimary: false } });
      const a = await tx.address.update({ where: { id: addressId }, data: input });
      await this.audit.record(
        { action: 'client.address_updated', entityType: 'Client', entityId: clientId, changes: diff(before, a, Object.keys(input)) },
        tx,
      );
      return a;
    });
  }

  async removeAddress(clientId: string, addressId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.address.findFirst({ where: { id: addressId, clientId } });
      if (!before) throw notFound('Address');
      await tx.address.delete({ where: { id: addressId } });
      if (before.isPrimary) {
        const next = await tx.address.findFirst({ where: { clientId }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit.record(
        { action: 'client.address_removed', entityType: 'Client', entityId: clientId, changes: { address: { from: before.line1, to: null } } },
        tx,
      );
    });
  }

  // ── Contacts (co-owners, authorized and emergency contacts) ──
  async addContact(clientId: string, input: ClientContactInput) {
    await this.mustExist(clientId);
    return this.prisma.db.$transaction(async (tx) => {
      const c = await tx.clientContact.create({ data: { ...input, clientId, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'client.contact_added', entityType: 'Client', entityId: clientId, summary: `${input.role}: ${input.name}` }, tx);
      return c;
    });
  }

  async updateContact(clientId: string, contactId: string, input: Partial<ClientContactInput>) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
      if (!before) throw notFound('Contact');
      const c = await tx.clientContact.update({ where: { id: contactId }, data: input });
      await this.audit.record(
        { action: 'client.contact_updated', entityType: 'Client', entityId: clientId, changes: diff(before, c, Object.keys(input)) },
        tx,
      );
      return c;
    });
  }

  async removeContact(clientId: string, contactId: string) {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.clientContact.findFirst({ where: { id: contactId, clientId } });
      if (!before) throw notFound('Contact');
      await tx.clientContact.delete({ where: { id: contactId } });
      await this.audit.record({ action: 'client.contact_removed', entityType: 'Client', entityId: clientId, summary: before.name }, tx);
    });
  }

  // ── Notes ──
  async addNote(clientId: string, input: { body: string; isPinned: boolean; category: 'GENERAL' | 'COMPLAINT' | 'FINANCIAL' | 'COMMUNICATION' }) {
    await this.mustExist(clientId);
    const ctx = RequestContext.require();
    return this.prisma.db.$transaction(async (tx) => {
      const n = await tx.clientNote.create({
        data: { ...input, clientId, organizationId: ctx.organizationId!, authorId: ctx.userId!, authorName: ctx.userName ?? 'Unknown' },
      });
      await this.audit.record({ action: 'client.note_added', entityType: 'Client', entityId: clientId, summary: input.category }, tx);
      return n;
    });
  }

  async setNotePinned(clientId: string, noteId: string, isPinned: boolean) {
    const n = await this.prisma.db.clientNote.findFirst({ where: { id: noteId, clientId } });
    if (!n) throw notFound('Note');
    return this.prisma.db.clientNote.update({ where: { id: noteId }, data: { isPinned } });
  }

  async exportCsv(q: ClientListQuery): Promise<string> {
    const where: Prisma.ClientWhereInput = { status: q.status === 'ALL' ? { not: 'MERGED' } : q.status, type: q.type };
    if (q.q) where.OR = this.searchClauses(q.q);
    const rows = await this.prisma.db.client.findMany({
      where,
      orderBy: { number: 'asc' },
      include: { addresses: { where: { isPrimary: true }, take: 1 } },
      take: 50_000,
    });
    const header = ['Client No', 'Type', 'Status', 'Name', 'Email', 'Mobile', 'Address', 'City', 'Reminders consent', 'Marketing consent', 'Created'];
    const lines = rows.map((c) =>
      [
        clientNo(c.number),
        c.type,
        c.status,
        c.displayName,
        c.email ?? '',
        c.mobilePhone ?? '',
        c.addresses[0]?.line1 ?? '',
        c.addresses[0]?.city ?? '',
        c.remindersConsent ? 'yes' : 'no',
        c.marketingConsent ? 'yes' : 'no',
        c.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(','),
    );
    await this.audit.record({ action: 'client.exported', entityType: 'Client', summary: `${rows.length} rows` });
    return [header.join(','), ...lines].join('\n');
  }

  private async mustExist(id: string) {
    const c = await this.prisma.db.client.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!c) throw notFound('Client');
    if (c.status === 'MERGED') throw ruleViolation('CLIENT_MERGED', 'This client was merged into another record');
    return c;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** CSV cell with formula-injection protection. */
