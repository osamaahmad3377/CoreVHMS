'use client';
import { hasFeature, PLAN_FEATURE_INFO, type PlanFeature } from '@vcms/shared';
import { Lock, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Whether the clinic's plan includes a feature (always true without plans). */
export function usePlanFeature(feature: PlanFeature): boolean {
  return hasFeature(useSession().session.entitlements, feature);
}

/** Shown in place of an area the plan does not include: what it does, and the way to get it. */
export function UpgradeCard({ feature, text, compact, className }: { feature: PlanFeature; text?: string; compact?: boolean; className?: string }) {
  const { session, canAny } = useSession();
  const info = PLAN_FEATURE_INFO[feature];
  const plan = session.entitlements?.planName;
  const owner = canAny('org.manage');
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.10] via-brand-2/[0.07] to-transparent ring-1 ring-inset ring-primary/15', compact ? 'p-4' : 'p-6 sm:p-8', className)}>
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/15 blur-3xl" />
      <div className="relative flex flex-wrap items-start gap-4">
        <span className={cn('flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-white shadow-lg', compact ? 'h-10 w-10' : 'h-12 w-12')}>
          <Lock className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <p className={cn('font-semibold tracking-tight', compact ? 'text-base' : 'text-lg')}>{info.label} is not in your {plan ? `${plan} ` : ''}plan</p>
          <p className="mt-1 text-sm text-muted-foreground">{text ?? info.description} Upgrade your plan to unlock it — it switches on within seconds.</p>
        </div>
        {owner ? (
          <Button asChild size={compact ? 'sm' : 'default'}>
            <Link href="/settings/plan">
              <Sparkles /> Upgrade
            </Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Ask the clinic owner to upgrade.</p>
        )}
      </div>
    </div>
  );
}

/** A small lock badge for buttons and cards. */
export function PlanLockBadge({ label = 'Upgrade' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-primary/10 px-2 py-0.5 text-2xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
      <Lock className="h-3 w-3" /> {label}
    </span>
  );
}
