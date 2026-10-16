'use client';

import type { Permission, SessionContext } from '@vcms/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { api, setActiveBranch } from './api';

interface SessionValue {
  session: SessionContext;
  can: (...perms: Permission[]) => boolean;
  canAny: (...perms: Permission[]) => boolean;
  currency: string;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSessionQuery() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionContext>('/auth/session'),
    staleTime: 60_000,
    retry: false,
  });
}

export function SessionProvider({ session, children }: { session: SessionContext; children: React.ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    setActiveBranch(session.branch?.id ?? null);
  }, [session.branch?.id]);

  const set = useMemo(() => new Set(session.permissions), [session.permissions]);
  const can = useCallback((...p: Permission[]) => p.every((x) => set.has(x)), [set]);
  const canAny = useCallback((...p: Permission[]) => p.some((x) => set.has(x)), [set]);
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['session'] });
  }, [qc]);

  return (
    <Ctx.Provider value={{ session, can, canAny, currency: session.organization?.currency ?? 'PKR', refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

/** True when the client portal is switched on for this installation (CLIENT_PORTAL_ENABLED on the API). */
export function usePortalEnabled(): boolean {
  return useSession().session.features?.clientPortal === true;
}
