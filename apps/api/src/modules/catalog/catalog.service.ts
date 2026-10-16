import { Injectable } from '@nestjs/common';
import type { SpeciesCategory } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContext } from '../../common/context/request-context';
import { notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listSpecies(includeInactive = false) {
    return this.prisma.db.species.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { breeds: true, patients: true } } },
    });
  }

  async listBreeds(speciesId: string) {
    return this.prisma.db.breed.findMany({ where: { speciesId, isActive: true }, orderBy: { name: 'asc' } });
  }

  async createSpecies(input: { name: string; category: SpeciesCategory; isActive?: boolean }) {
    return this.prisma.db.$transaction(async (tx) => {
      const s = await tx.species.create({ data: { ...input, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'species.created', entityType: 'Species', entityId: s.id, summary: s.name }, tx);
      return s;
    });
  }

  async updateSpecies(id: string, input: Partial<{ name: string; category: SpeciesCategory; isActive: boolean }>) {
    const existing = await this.prisma.db.species.findUnique({ where: { id } });
    if (!existing) throw notFound('Species');
    return this.prisma.db.$transaction(async (tx) => {
      const s = await tx.species.update({ where: { id }, data: input });
      await this.audit.record({ action: 'species.updated', entityType: 'Species', entityId: id, summary: s.name }, tx);
      return s;
    });
  }

  async createBreed(speciesId: string, name: string) {
    const species = await this.prisma.db.species.findUnique({ where: { id: speciesId } });
    if (!species) throw notFound('Species');
    return this.prisma.db.$transaction(async (tx) => {
      const b = await tx.breed.create({ data: { speciesId, name, organizationId: RequestContext.orgId() } });
      await this.audit.record({ action: 'breed.created', entityType: 'Breed', entityId: b.id, summary: `${species.name}: ${name}` }, tx);
      return b;
    });
  }

  async setBreedActive(id: string, isActive: boolean) {
    const b = await this.prisma.db.breed.findUnique({ where: { id } });
    if (!b) throw notFound('Breed');
    return this.prisma.db.breed.update({ where: { id }, data: { isActive } });
  }
}
