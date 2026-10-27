'use client';
import { featureOfPermission, hasFeature, type Permission } from '@vcms/shared';
import { ShieldOff } from 'lucide-react';
import { useSession } from '@/lib/session';
import { EmptyState } from './page';
import { FeatureLockedPage } from './plan/upgrade';

/** Page-level guard for a friendlier UX. The API enforces the same permissions server-side. */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: React.ReactNode }) {
  const { canAny, session } = useSession();
  if (!canAny(...anyOf)) {
    // An area outside the clinic's plan: say which plan includes it, instead of "access denied".
    const features = anyOf.map(featureOfPermission);
    const locked = features.every((f) => f && !hasFeature(session.entitlements, f)) ? features[0] : null;
    if (locked) return <FeatureLockedPage feature={locked} />;
    return <EmptyState icon={ShieldOff} title="Access denied" description="Your role does not include permission to view this page. Ask a practice manager if you need access." />;
  }
  return <>{children}</>;
}
