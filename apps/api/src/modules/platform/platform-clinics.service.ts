import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import type { ClinicOverview, ClinicUsage, CreateClinicInput, PlatformClinic } from '@vcms/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { generateTemporaryPassword, hashPassword } from '../../common/crypto/password';
import { conflict, notFound, ruleViolation } from '../../common/http/errors';
import { escapeHtml, layout, MailService } from '../../common/mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { addressFor, multiClinic, RESERVED_SLUGS } from '../../common/tenancy/hosts';
import { createDatabase, databaseExists, migrateDatabase, tenantDatabaseName } from '../../common/tenancy/tenant-databases';
import { TenancyService, tenantRef } from '../../common/tenancy/tenancy.service';
import { OrgBootstrapService } from '../organizations/org-bootstrap.service';
import { TEMP_PASSWORD_DAYS } from '../users/users.service';

const INVITE_DAYS = 7;


export function toClinic(t: Tenant): PlatformClinic {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    address: addressFor(t.slug),
    databaseName: t.databaseName,
    status: t.status,
    country: t.country,
    ownerName: t.ownerName,
    ownerEmail: t.ownerEmail,
    ownerAccess: t.ownerAccess as PlatformClinic['ownerAccess'],
    lastError: t.lastError,
    provisionedAt: t.provisionedAt?.toISOString() ?? null,
    suspendedAt: t.suspendedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * Super admin: hosted clinics. Adding a clinic records it in the platform database, then sets it up in the
 * background: creates its own PostgreSQL database, applies every migration, and creates the organization,
 * main branch, roles, owner account and starter lists inside it.
 */
@Injectable()
export class PlatformClinicsService {
  private readonly log = new Logger(PlatformClinicsService.name);
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly bootstrap: OrgBootstrapService,
    private readonly tenancy: TenancyService,
  ) {}

  private assertPlatform() {
    if (!multiClinic() || !RequestContext.get()?.platform) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Multi-clinic hosting is not switched on' });
    }
  }

  private async find(id: string) {
    this.assertPlatform();
    const t = await this.prisma.control.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Clinic');
    return t;
  }

  async list() {
    this.assertPlatform();
    const rows = await this.prisma.control.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toClinic);
  }

  async get(id: string) {
    return toClinic(await this.find(id));
  }

  /**
   * One clinic at a glance for the super admin: details, how much it is used (counted in the clinic's own
   * database; nothing clinical is read) and the history of what the platform did to it.
   */
  async overview(id: string): Promise<ClinicOverview> {
    const t = await this.find(id);
    let usage: ClinicUsage | null = null;
    if (t.status === 'ACTIVE' || t.status === 'SUSPENDED') {
      try {
        usage = await RequestContext.runInTenant(tenantRef(t), async () => {
          const raw = this.prisma.raw;
          const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
          const [staff, activeStaff, clients, patients, appointmentsThisMonth, lastSignIn] = await Promise.all([
            raw.membership.count(),
            raw.membership.count({ where: { status: 'ACTIVE' } }),
            raw.client.count({ where: { status: { not: 'MERGED' } } }),
            raw.patient.count({ where: { status: { not: 'MERGED' } } }),
            raw.appointment.count({ where: { startsAt: { gte: monthStart } } }),
            raw.user.findFirst({ where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: 'desc' }, select: { lastLoginAt: true } }),
          ]);
          return { staff, activeStaff, clients, patients, appointmentsThisMonth, lastSignInAt: lastSignIn?.lastLoginAt?.toISOString() ?? null };
        });
      } catch (e) {
        this.log.warn(`Usage for ${t.slug} unavailable: ${(e as Error).message}`);
      }
    }
    const events = await this.prisma.control.auditEvent.findMany({
      where: { entityType: 'Tenant', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, summary: true, actorName: true, createdAt: true },
    });
    return { clinic: toClinic(t), usage, events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) };
  }

  async create(input: CreateClinicInput) {
    this.assertPlatform();
    if (RESERVED_SLUGS.has(input.slug)) throw ruleViolation('ADDRESS_RESERVED', 'This address is reserved. Choose another one.');
    if (await this.prisma.control.tenant.findUnique({ where: { slug: input.slug } })) {
      throw conflict('Another clinic already uses this address');
    }
    const databaseName = tenantDatabaseName(input.slug);
    if (await databaseExists(this.prisma.control, databaseName)) {
      throw conflict(`A database named ${databaseName} already exists on the server. Choose another address, or remove that database first.`);
    }
    const temporaryPassword = input.ownerAccess === 'TEMPORARY_PASSWORD' ? generateTemporaryPassword() : null;
    const tenant = await this.prisma.control.$transaction(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          slug: input.slug,
          name: input.name,
          databaseName,
          country: input.country,
          branchName: input.branchName,
          ownerName: input.ownerName,
          ownerEmail: input.ownerEmail,
          ownerAccess: input.ownerAccess,
          ownerPasswordHash: temporaryPassword ? await hashPassword(temporaryPassword) : null,
          createdById: RequestContext.get()?.userId ?? null,
        },
      });
      await this.audit.record({ action: 'platform.clinic_created', entityType: 'Tenant', entityId: t.id, summary: `${t.name} (${t.slug})`, organizationId: null }, tx);
      return t;
    });
    this.start(tenant.id);
    return {
      clinic: toClinic(tenant),
      temporaryPassword,
      expiresAt: temporaryPassword ? new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000).toISOString() : null,
    };
  }

  /** Sets up a clinic that failed part-way (each step is safe to repeat). */
  async retry(id: string) {
    const t = await this.find(id);
    const r = await this.prisma.control.tenant.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PROVISIONING', lastError: null } });
    if (!r.count) throw ruleViolation('NOT_FAILED', 'Only a clinic whose set-up failed can be retried');
    await this.audit.record({ action: 'platform.clinic_setup_retried', entityType: 'Tenant', entityId: t.id, summary: t.slug, organizationId: null });
    this.start(id);
    return this.get(id);
  }

  async suspend(id: string) {
    const t = await this.find(id);
    if (t.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'Only an active clinic can be paused');
    await this.prisma.control.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
      await this.audit.record({ action: 'platform.clinic_suspended', entityType: 'Tenant', entityId: id, summary: t.slug, organizationId: null }, tx);
    });
    this.tenancy.forget(t.slug);
    await this.prisma.release(t.databaseName);
    return this.get(id);
  }

  async reactivate(id: string) {
    const t = await this.find(id);
    if (t.status !== 'SUSPENDED') throw ruleViolation('NOT_SUSPENDED', 'Only a paused clinic can be reactivated');
    await this.prisma.control.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id }, data: { status: 'ACTIVE', suspendedAt: null } });
      await this.audit.record({ action: 'platform.clinic_reactivated', entityType: 'Tenant', entityId: id, summary: t.slug, organizationId: null }, tx);
    });
    this.tenancy.forget(t.slug);
    return this.get(id);
  }

  /** New temporary password for the clinic's first owner (lost password, or the invitation never arrived). */
  async resetOwnerPassword(id: string) {
    const t = await this.find(id);
    if (t.status !== 'ACTIVE') throw ruleViolation('NOT_ACTIVE', 'The clinic must be active');
    const password = generateTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400_000);
    await RequestContext.runInTenant(tenantRef(t), async () => {
      const raw = this.prisma.raw;
      const user = await raw.user.findUnique({ where: { email: t.ownerEmail } });
      if (!user) throw notFound('Owner account');
      await raw.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, temporaryPasswordExpiresAt: expiresAt, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
        });
        await tx.membership.updateMany({ where: { userId: user.id, status: 'INVITED' }, data: { status: 'ACTIVE', joinedAt: new Date() } });
        await tx.authToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await this.audit.record({ action: 'membership.temporary_password_issued', entityType: 'User', entityId: user.id, summary: `${user.email} (by NextCore super admin)`, organizationId: t.organizationId, actorUserId: null, actorName: 'NextCore super admin' }, tx);
      });
    });
    await this.audit.record({ action: 'platform.clinic_owner_password_reset', entityType: 'Tenant', entityId: id, summary: t.ownerEmail, organizationId: null });
    return { clinic: toClinic(t), temporaryPassword: password, expiresAt: expiresAt.toISOString() };
  }

  // ── Set-up ──

  private start(id: string) {
    if (this.running.has(id)) return;
    const job = this.provision(id).finally(() => this.running.delete(id));
    this.running.set(id, job);
  }

  /** Resolves when any set-up in progress for this clinic has finished (tests and the command line). */
  async settled(id: string) {
    await this.running.get(id);
  }

  async provision(id: string) {
    const t = await this.prisma.control.tenant.findUniqueOrThrow({ where: { id } });
    if (t.status !== 'PROVISIONING') return;
    try {
      await createDatabase(this.prisma.control, t.databaseName);
      await migrateDatabase(t.databaseName);
      const organizationId = await RequestContext.runInTenant(tenantRef(t), () => this.setUpClinic(t));
      await this.prisma.control.$transaction(async (tx) => {
        await tx.tenant.update({
          where: { id },
          data: { status: 'ACTIVE', organizationId, ownerPasswordHash: null, lastError: null, provisionedAt: new Date() },
        });
        await this.audit.record({ action: 'platform.clinic_ready', entityType: 'Tenant', entityId: id, summary: t.slug, organizationId: null, actorUserId: null, actorName: 'System' }, tx);
      });
      this.log.log(`Clinic ${t.slug} is ready (database ${t.databaseName})`);
    } catch (e) {
      const message = (e as Error).message.slice(0, 2000);
      this.log.error(`Setting up clinic ${t.slug} failed: ${message}`);
      await this.prisma.control.tenant.update({ where: { id }, data: { status: 'FAILED', lastError: message } });
    } finally {
      this.tenancy.forget(t.slug);
    }
  }

  /** Runs inside the clinic's database. Repeating it after a partial failure reuses what already exists. */
  private async setUpClinic(t: Tenant): Promise<string> {
    const raw = this.prisma.raw;
    const existing = await raw.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing.id;

    const invite = t.ownerAccess === 'INVITATION';
    const token = invite ? randomToken(32) : null;
    const orgId = await raw.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: invite
            ? { email: t.ownerEmail, name: t.ownerName }
            : {
                email: t.ownerEmail,
                name: t.ownerName,
                passwordHash: t.ownerPasswordHash,
                passwordChangedAt: new Date(),
                mustChangePassword: true,
                temporaryPasswordExpiresAt: new Date(t.createdAt.getTime() + TEMP_PASSWORD_DAYS * 86400_000),
              },
        });
        const { org, membership } = await this.bootstrap.create(tx, { name: t.name, country: t.country as 'PK' | 'AU', branchName: t.branchName, ownerUserId: user.id });
        await this.bootstrap.starterSetup(tx, org.id);
        if (token) {
          await tx.membership.update({ where: { id: membership.id }, data: { status: 'INVITED', joinedAt: null } });
          await tx.authToken.create({
            data: { type: 'INVITATION', tokenHash: sha256(token), userId: user.id, organizationId: org.id, membershipId: membership.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) },
          });
        }
        await this.audit.record({ action: 'organization.created', entityType: 'Organization', entityId: org.id, organizationId: org.id, summary: 'Set up by NextCore super admin', actorUserId: null, actorName: 'NextCore super admin' }, tx);
        return org.id;
      },
      { timeout: 60_000 },
    );

    if (token) {
      const link = `${addressFor(t.slug)}/accept-invite?token=${encodeURIComponent(token)}`;
      try {
        await this.mail.send({
          to: t.ownerEmail,
          subject: `${t.name} is ready on NextCore VCMS`,
          text: `Hello ${t.ownerName},\n\nYour clinic ${t.name} has been set up on NextCore VCMS at ${addressFor(t.slug)}.\nChoose your password within ${INVITE_DAYS} days: ${link}`,
          html: layout(
            `${escapeHtml(t.name)} is ready`,
            `<p>Hello ${escapeHtml(t.ownerName)},</p><p>Your clinic <b>${escapeHtml(t.name)}</b> has been set up on NextCore VCMS.</p>
<p>Your clinic’s address: <a href="${addressFor(t.slug)}">${addressFor(t.slug)}</a></p>
<p><a href="${link}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choose your password</a></p>
<p style="color:#6b7b80">This link expires in ${INVITE_DAYS} days.</p>`,
          ),
        });
      } catch (e) {
        // The clinic is set up; the super admin can give the owner a temporary password instead.
        this.log.error(`Invitation email to ${t.ownerEmail} failed: ${(e as Error).message}`);
      }
    }
    return orgId;
  }
}
