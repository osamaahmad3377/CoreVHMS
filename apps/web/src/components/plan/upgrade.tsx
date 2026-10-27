'use client';
import { hasFeature, PLAN_FEATURE_BENEFITS, PLAN_FEATURE_INFO, PLAN_FEATURES, planNames, plansWithFeature, upgradeLine, type PlanBrief, type PlanFeature } from '@vcms/shared';
import { Check, Crown, Lock, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { limitNote, usePlanUsage } from '@/hooks/use-plan-usage';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Whether the clinic's plan includes a feature (always true without plans). */
export function usePlanFeature(feature: PlanFeature): boolean {
  return hasFeature(useSession().session.entitlements, feature);
}

/** "Rs 9,800" — a monthly plan price without the paisa/cents. */
const price = (p: PlanBrief) => fmtMoney(p.priceMonthlyMinor, p.currency).replace(/\.00$/, '');

/**
 * Shown in place of an area the plan does not include: what it does, which plans include it, and the way to get it.
 * Owners get "Upgrade to …"; other staff are told to ask the owner. `compact` is a one-line version inside a page.
 */
export function UpgradeCard({ feature, text, compact, className }: { feature: PlanFeature; text?: string; compact?: boolean; className?: string }) {
  const { session, canAny } = useSession();
  const e = session.entitlements;
  const info = PLAN_FEATURE_INFO[feature];
  const current = e?.planName;
  const owner = canAny('org.manage');
  const plans = plansWithFeature(e, feature);
  const target = plans[0];
  const where = plans.length ? `the ${planNames(plans, 'and')} plan${plans.length > 1 ? 's' : ''}` : 'a higher plan';
  const href = `/settings/plan?unlock=${feature}`;
  const upgradeButton = (size: 'sm' | 'default') => (
    <Button asChild size={size}>
      <Link href={href}>
        <Sparkles /> {target ? `Upgrade to ${target.name}` : 'Upgrade plan'}
      </Link>
    </Button>
  );

  if (compact) {
    return (
      <div className={cn('flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-br from-primary/[0.10] via-brand-2/[0.06] to-transparent p-4 ring-1 ring-inset ring-primary/15', className)}>
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-2 text-white shadow">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold tracking-tight">{info.label} is available on {where}</p>
          <p className="text-sm text-muted-foreground">
            {text ?? info.description} {owner ? upgradeLine(plans) : `Ask your clinic owner to upgrade${target ? ` to ${planNames(plans)}` : ''} to use it.`}
          </p>
        </div>
        {owner && upgradeButton('sm')}
      </div>
    );
  }

  return (
    <section aria-labelledby={`locked-${feature}`} className={cn('relative overflow-hidden rounded-3xl bg-card p-6 shadow-card ring-1 ring-inset ring-primary/10 sm:p-10', className)}>
      <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/[0.12] blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-60 w-60 rounded-full bg-brand-2/[0.10] blur-3xl" />
      <div className="relative mx-auto grid max-w-3xl gap-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-brand-2 text-white shadow-lg">
            <Lock className="h-7 w-7" />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
            <Sparkles className="h-3.5 w-3.5" /> {target ? `${target.name} feature` : 'Upgrade to unlock'}
          </span>
          <div>
            <h2 id={`locked-${feature}`} className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{info.label} is available on {where}</h2>
            <p className="mx-auto mt-2 max-w-xl text-pretty text-muted-foreground">
              {text ?? info.description} {current ? `Your clinic is on the ${current} plan. ` : ''}
              {owner ? 'Upgrade your plan to start using it.' : 'Ask your clinic owner to upgrade the plan to use it.'}
            </p>
          </div>
        </div>

        <ul className="mx-auto grid w-full max-w-xl gap-2.5">
          {PLAN_FEATURE_BENEFITS[feature].map((b) => (
            <li key={b} className="flex items-start gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm">
              <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-3.5 w-3.5" />
              </span>
              {b}
            </li>
          ))}
        </ul>

        {owner && plans.length > 0 && (
          <div className="mx-auto flex w-full max-w-xl flex-wrap justify-center gap-2">
            {plans.map((p, i) => (
              <span key={p.name} className={cn('inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5 text-sm ring-1 ring-inset', i === 0 ? 'bg-primary/10 ring-primary/25' : 'bg-muted/60 ring-border')}>
                <Crown className={cn('h-3.5 w-3.5', i === 0 ? 'text-primary' : 'text-amber-500')} aria-hidden />
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted-foreground">{price(p)} / month</span>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          {owner ? (
            <>
              {upgradeButton('default')}
              <Button asChild variant="outline">
                <Link href="/settings/plan">Compare plans</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="w-full text-center text-sm text-muted-foreground">Only the clinic owner can change the plan.</p>
              <Button asChild variant="outline">
                <Link href="/dashboard">Back to dashboard</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** A whole page the plan does not include (opened from the menu, a link or the address bar). */
export function FeatureLockedPage({ feature }: { feature: PlanFeature }) {
  return (
    <div className="grid gap-6">
      <PageHeader title={PLAN_FEATURE_INFO[feature].label} description="Not included in your current plan" />
      <UpgradeCard feature={feature} />
    </div>
  );
}

/** Whether the plan already has every area (nothing left to unlock). */
function topPlan(e: { features: readonly string[] } | null | undefined) {
  return !e || PLAN_FEATURES.every((f) => e.features.includes(f));
}

/**
 * The clinic's current plan, at the top of Settings: its name, what it uses against its limits, and for owners
 * a way to see plans or upgrade. Without plans (a single installation) it says the clinic has full access.
 */
export function PlanBanner() {
  const { session, canAny } = useSession();
  const e = session.entitlements;
  const usage = usePlanUsage();
  const name = e?.planName ? `${e.planName} plan` : 'Full access';
  const owner = canAny('org.manage');
  const upgrade = owner && !!e?.planName && !topPlan(e);
  const limits = [limitNote(usage.staff, 'staff'), limitNote(usage.branches, usage.branches.max === 1 ? 'branch' : 'branches'), limitNote(usage.automations, 'automations')]
    .filter(Boolean)
    .map((t) => t.replace(/ used$/, ''));
  const included = e ? PLAN_FEATURES.filter((f) => e.features.includes(f)).length : PLAN_FEATURES.length;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400/[0.14] via-primary/[0.07] to-transparent p-5 ring-1 ring-inset ring-amber-500/20">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-4">
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg">
          <Crown className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your plan</p>
          <p className="text-lg font-semibold tracking-tight">{name}</p>
          <p className="text-sm text-muted-foreground">
            {e?.planName
              ? `${included} of ${PLAN_FEATURES.length} areas included${limits.length ? ` · ${limits.join(' · ')}` : ''}`
              : 'Every area is included, with no limits on staff, branches or automations.'}
          </p>
        </div>
        {owner && (
          <Button asChild variant={upgrade ? 'default' : 'outline'} size="sm">
            <Link href="/settings/plan">
              {upgrade ? <><Sparkles /> Upgrade</> : 'See plan details'}
            </Link>
          </Button>
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
