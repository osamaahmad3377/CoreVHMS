import { Injectable, Logger } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { RequestContext, TenantRef } from '../context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { multiClinic } from './hosts';

const CACHE_MS = 15_000;

export const tenantRef = (t: Pick<Tenant, 'id' | 'slug' | 'name' | 'databaseName'>): TenantRef => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  databaseName: t.databaseName,
});

/** Looks up hosted clinics in the platform database and runs work against each clinic's database. */
@Injectable()
export class TenancyService {
  private readonly log = new Logger(TenancyService.name);
  private readonly cache = new Map<string, { tenant: Tenant | null; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Clinic by subdomain (briefly cached; status changes take effect within seconds). */
  async bySlug(slug: string): Promise<Tenant | null> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
    const tenant = await this.prisma.control.tenant.findUnique({ where: { slug } });
    this.cache.set(slug, { tenant, at: Date.now() });
    return tenant;
  }

  forget(slug: string) {
    this.cache.delete(slug);
  }

  /**
   * Runs a background job once per active clinic database (multi-clinic mode), or once against DATABASE_URL.
   * A failure in one clinic is logged and does not stop the others.
   */
  async forEachDatabase(job: string, fn: () => Promise<unknown>) {
    if (!multiClinic()) {
      await fn();
      return;
    }
    const tenants = await this.prisma.control.tenant.findMany({ where: { status: 'ACTIVE' }, orderBy: { slug: 'asc' } });
    for (const t of tenants) {
      try {
        await RequestContext.runInTenant(tenantRef(t), fn);
      } catch (e) {
        this.log.error(`${job} failed for clinic ${t.slug}: ${(e as Error).message}`);
      }
    }
  }
}
