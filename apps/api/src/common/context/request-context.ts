import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  userName?: string;
  sessionId?: string;
  organizationId?: string;
  branchId?: string;
  membershipId?: string;
  permissions: Set<string>;
  /** Set only by trusted background jobs that must operate across tenants. */
  system?: boolean;
  /** Multi-clinic hosting: the clinic addressed by the request's subdomain; all data access uses its database. */
  tenant?: TenantRef;
  /** Multi-clinic hosting: the request came to the super admin address (platform database). */
  platform?: boolean;
}

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  databaseName: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
  require(): RequestContextStore {
    const store = storage.getStore();
    if (!store) throw new Error('No request context');
    return store;
  },
  /** Organization of the current request; throws if missing (fail closed). */
  orgId(): string {
    const org = storage.getStore()?.organizationId;
    if (!org) throw new Error('No organization in request context');
    return org;
  },
  /** Run a function as a given organization (seeding, jobs, tests), staying in the current clinic database. */
  runAs<T>(partial: Partial<RequestContextStore> & { organizationId: string }, fn: () => T): T {
    const current = storage.getStore();
    return storage.run({ requestId: 'system', permissions: new Set(), tenant: current?.tenant, ...partial }, fn);
  },
  /** Run a function against one clinic's database (provisioning, background jobs). */
  runInTenant<T>(tenant: TenantRef, fn: () => T): T {
    return storage.run({ requestId: 'system', userName: 'System', permissions: new Set(), tenant }, fn);
  },
};
