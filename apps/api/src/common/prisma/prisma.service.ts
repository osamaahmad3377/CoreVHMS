import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { RequestContext } from '../context/request-context';
import { databaseUrl } from '../tenancy/tenant-databases';
import { ScopedPrismaClient, withTenantScope } from './tenant-extension';

interface ClinicClient {
  raw: PrismaClient;
  db: ScopedPrismaClient;
  lastUsed: number;
}

/** A clinic database's connections are closed after this long without use (reopened on demand). */
const IDLE_CLOSE_MS = 10 * 60_000;

function newClient(url?: string) {
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    // Errors are surfaced through the exception filter; logging them here would duplicate expected 4xx cases.
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn'],
  });
}

/**
 * Database access. `raw` and `db` follow the request: in multi-clinic mode they use the database of the clinic
 * named by the subdomain (RequestContext.tenant); otherwise the database in DATABASE_URL. Code that must reach
 * the platform database regardless of the request uses `control`.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);
  /** DATABASE_URL: the clinic database in single-clinic mode, the platform database in multi-clinic mode. */
  readonly control: PrismaClient;
  private readonly controlDb: ScopedPrismaClient;
  private readonly clinics = new Map<string, ClinicClient>();
  private sweeper?: NodeJS.Timeout;

  constructor() {
    this.control = newClient();
    this.controlDb = withTenantScope(this.control);
  }

  /** Unscoped client. Only for identity/auth, platform jobs and audit writes. */
  get raw(): PrismaClient {
    const tenant = RequestContext.get()?.tenant;
    return tenant ? this.clinic(tenant.databaseName).raw : this.control;
  }

  /** Tenant-scoped client. Use for all organization data. */
  get db(): ScopedPrismaClient {
    const tenant = RequestContext.get()?.tenant;
    return tenant ? this.clinic(tenant.databaseName).db : this.controlDb;
  }

  private clinic(databaseName: string): ClinicClient {
    let c = this.clinics.get(databaseName);
    if (!c) {
      const raw = newClient(databaseUrl(databaseName, { pool: env().TENANT_DB_POOL }));
      c = { raw, db: withTenantScope(raw), lastUsed: Date.now() };
      this.clinics.set(databaseName, c);
    }
    c.lastUsed = Date.now();
    return c;
  }

  /** Closes and forgets a clinic's connections (e.g. after it is suspended). */
  async release(databaseName: string) {
    const c = this.clinics.get(databaseName);
    this.clinics.delete(databaseName);
    await c?.raw.$disconnect();
  }

  async onModuleInit() {
    await this.control.$connect();
    this.sweeper = setInterval(() => void this.closeIdle(), 60_000);
    this.sweeper.unref();
  }

  private async closeIdle() {
    const cutoff = Date.now() - IDLE_CLOSE_MS;
    for (const [name, c] of this.clinics) {
      if (c.lastUsed < cutoff) {
        this.clinics.delete(name);
        await c.raw.$disconnect().catch((e) => this.log.warn(`Closing ${name}: ${(e as Error).message}`));
      }
    }
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.clinics.values()].map((c) => c.raw.$disconnect()));
    this.clinics.clear();
    await this.control.$disconnect();
  }
}
