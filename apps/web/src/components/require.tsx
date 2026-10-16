'use client';
import type { Permission } from '@vcms/shared';
import { ShieldOff } from 'lucide-react';
import { useSession } from '@/lib/session';
import { EmptyState } from './page';

/** Page-level guard for a friendlier UX. The API enforces the same permissions server-side. */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: React.ReactNode }) {
  const { canAny } = useSession();
  if (!canAny(...anyOf)) {
    return <EmptyState icon={ShieldOff} title="Access denied" description="Your role does not include permission to view this page. Ask a practice manager if you need access." />;
  }
  return <>{children}</>;
}
