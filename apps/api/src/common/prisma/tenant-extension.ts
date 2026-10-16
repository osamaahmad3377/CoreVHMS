import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContext } from '../context/request-context';

/** Models that are NOT tenant-scoped (identity, sessions, platform-level audit). */
const GLOBAL_MODELS = new Set([
  'Organization',
  'User',
  'Session',
  'MfaChallenge',
  'AuthToken',
  'AuditEvent',
  'RolePermission',
  'MembershipRole',
  'MembershipBranch',
]);

export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => !GLOBAL_MODELS.has(m.name) && m.fields.some((f) => f.name === 'organizationId'))
    .map((m) => m.name),
);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

function stampData(data: any, orgId: string, model: string) {
  if (!data || typeof data !== 'object') return data;
  if (data.organizationId && data.organizationId !== orgId) {
    throw new TenantIsolationError(`Attempt to write ${model} into another organization`);
  }
  if (data.organization) return data; // checked input with relation connect: validated by FK + where scoping
  return { ...data, organizationId: orgId };
}

/**
 * Prisma extension that injects the current organization into every query on tenant models.
 * Queries on tenant models without an organization in context fail closed.
 */
export function withTenantScope(client: PrismaClient) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          const ctx = RequestContext.get();
          const orgId = ctx?.organizationId;
          if (!orgId) {
            throw new TenantIsolationError(`${model}.${operation} called without an organization context`);
          }
          const a: any = args ?? {};
          if (WHERE_OPS.has(operation)) {
            if (a.where?.organizationId && a.where.organizationId !== orgId) {
              throw new TenantIsolationError(`Cross-tenant ${model}.${operation} blocked`);
            }
            a.where = { ...(a.where ?? {}), organizationId: orgId };
          }
          if (operation === 'create') a.data = stampData(a.data, orgId, model);
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            a.data = Array.isArray(a.data) ? a.data.map((d: any) => stampData(d, orgId, model)) : stampData(a.data, orgId, model);
          }
          if (operation === 'upsert') a.create = stampData(a.create, orgId, model);
          if ((operation === 'update' || operation === 'updateMany' || operation === 'upsert') && a.data?.organizationId) {
            if (a.data.organizationId !== orgId) throw new TenantIsolationError(`Cannot move ${model} between organizations`);
          }
          if (operation === 'upsert' && a.update?.organizationId && a.update.organizationId !== orgId) {
            throw new TenantIsolationError(`Cannot move ${model} between organizations`);
          }
          return query(a);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof withTenantScope>;
export type ScopedTx = Parameters<Parameters<ScopedPrismaClient['$transaction']>[0]>[0];
