'use client';
import { useQuery } from '@tanstack/react-query';
import { PLAN_FEATURES, PLAN_FEATURE_INFO, type ClinicPlanView } from '@vcms/shared';
import { Check, Lock } from 'lucide-react';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div className="rounded-xl surface-flat p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {used} <span className="text-base font-normal text-muted-foreground">{limit === null ? 'in use · no limit' : `of ${limit}`}</span>
      </p>
      {limit !== null && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
          <div className={cn('h-full rounded-full', used > limit ? 'bg-destructive' : full ? 'bg-warning' : 'bg-primary')} style={{ width: `${used > limit ? 100 : pct}%` }} />
        </div>
      )}
      {full && <p className="mt-2 text-xs text-warning">{used > (limit ?? 0) ? 'Over the limit: you keep what you have but cannot add more.' : 'Full: you cannot add more until you ask NextCore for a bigger plan.'}</p>}
    </div>
  );
}

function PlanView() {
  const q = useQuery({ queryKey: ['clinic-plan'], queryFn: () => api.get<ClinicPlanView>('/organization/plan') });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { entitlements: e, usage } = q.data;
  const missing = PLAN_FEATURES.filter((f) => !e.features.includes(f));
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">{e.planName ? `${e.planName} plan` : 'Full access'} <Badge variant="success">Active</Badge></CardTitle>
            <CardDescription className="mt-1">{e.planName ? 'What your clinic may use, and how many staff and branches it may have.' : 'Your clinic has no limits.'}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Meter label="Staff accounts" used={usage.staff} limit={e.maxStaff} />
            <Meter label="Branches" used={usage.branches} limit={e.maxBranches} />
          </div>
          <p className="text-xs text-muted-foreground">Staff accounts counted: active and invited people. Paused staff and paused branches do not count.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What is included</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-2 sm:grid-cols-2">
            {PLAN_FEATURES.map((f) => {
              const on = e.features.includes(f);
              return (
                <li key={f} className={cn('flex items-start gap-2 rounded-lg surface-flat p-3 text-sm', !on && 'bg-muted/40 text-muted-foreground')}>
                  {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Included" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-label="Not in your plan" />}
                  <span>
                    <span className="block font-medium">{PLAN_FEATURE_INFO[f].label}</span>
                    <span className="block text-xs">{on ? PLAN_FEATURE_INFO[f].description : 'Not in your plan'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground">Everyday work — clients, patients, appointments, consultations, billing, pharmacy, stock, the shop counter and vaccinations — is always included.</p>
          {missing.length > 0 && <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">Want {missing.length === 1 ? PLAN_FEATURE_INFO[missing[0]].label : 'more'}, more staff or another branch? <b>Ask NextCore</b> to change your plan. It applies within seconds.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlanPage() {
  return (
    <RequirePermission anyOf={['org.manage']}>
      <PlanView />
    </RequirePermission>
  );
}
