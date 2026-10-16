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
  /** Run a function as a given tenant (seeding, jobs, tests). */
  runAs<T>(partial: Partial<RequestContextStore> & { organizationId: string }, fn: () => T): T {
    return storage.run({ requestId: 'system', permissions: new Set(), ...partial }, fn);
  },
};
