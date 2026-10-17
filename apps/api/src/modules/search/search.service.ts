import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientsService, clientNo } from '../clients/clients.service';
import { PatientsService, patientNo } from '../patients/patients.service';

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
  badge?: string | null;
  /** Clients only, for users who can see billing: what they owe (positive) or their credit (negative), minor units. */
  balanceMinor?: number | null;
}

export type SearchProvider = (q: string, permissions: Set<string>) => Promise<SearchHit[]>;

/** Global search across modules. Each module contributes a provider gated by its own permission. */
@Injectable()
export class SearchService {
  private readonly providers: SearchProvider[] = [];

  constructor(
    private readonly prisma: PrismaService,
    clients: ClientsService,
    patients: PatientsService,
  ) {
    this.register(async (q, perms) => {
      if (!perms.has('patients.read')) return [];
      const rows = await this.prisma.db.patient.findMany({
        where: { status: { not: 'MERGED' }, OR: patients.searchClauses(q) },
        include: {
          species: { select: { name: true } },
          ownerships: { where: { endedAt: null, isPrimary: true }, include: { client: { select: { displayName: true, mobilePhone: true } } } },
        },
        take: 8,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
      return rows.map((p) => ({
        type: 'patient',
        id: p.id,
        title: `${p.name} (${p.species.name})`,
        subtitle: [patientNo(p.number), p.ownerships[0]?.client.displayName ?? 'No client', p.ownerships[0]?.client.mobilePhone].filter(Boolean).join(' · '),
        href: `/patients/${p.id}`,
        badge: p.status !== 'ACTIVE' ? p.status : null,
      }));
    });
    this.register(async (q, perms) => {
      if (!perms.has('clients.read')) return [];
      const rows = await this.prisma.db.client.findMany({
        where: { status: { not: 'MERGED' }, OR: clients.searchClauses(q) },
        take: 6,
        orderBy: { displayName: 'asc' },
      });
      return rows.map((c) => ({
        type: 'client',
        id: c.id,
        title: c.displayName,
        subtitle: [clientNo(c.number), c.mobilePhone, c.email].filter(Boolean).join(' · '),
        href: `/clients/${c.id}`,
        badge: c.status !== 'ACTIVE' ? c.status : null,
        balanceMinor: perms.has('billing.read') ? c.balanceMinor : null,
      }));
    });
  }

  register(provider: SearchProvider) {
    this.providers.push(provider);
  }

  async search(q: string, permissions: Set<string>) {
    const results = await Promise.all(this.providers.map((p) => p(q, permissions).catch(() => [] as SearchHit[])));
    return { query: q, results: results.flat() };
  }
}
