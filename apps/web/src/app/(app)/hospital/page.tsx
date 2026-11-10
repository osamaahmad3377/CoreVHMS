'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, BedDouble, Bird, Cat, Clock, Dog, HeartPulse, Home, Plus, Scissors, ShieldAlert, Siren, Stethoscope, Tractor, Activity, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { AdmitDialog } from '@/components/hospital/admit-dialog';
import { CprBadge, IsolationBadge } from '@/components/hospital/badges';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Admission, Flowboard } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Condition colours: a stripe on the card, a dot and a soft label. */
const CONDITION: Record<Admission['condition'], { label: string; stripe: string; chip: string }> = {
  STABLE: { label: 'Stable', stripe: 'bg-success', chip: 'bg-success/12 text-success' },
  FAIR: { label: 'Fair', stripe: 'bg-sky-500', chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  GUARDED: { label: 'Guarded', stripe: 'bg-warning', chip: 'bg-warning/15 text-warning' },
  CRITICAL: { label: 'Critical', stripe: 'bg-destructive', chip: 'bg-destructive/10 text-destructive' },
};

const WARD_ICON: Record<string, LucideIcon> = { ICU: HeartPulse, ISOLATION: ShieldAlert, CATTERY: Cat, KENNEL: Dog, LARGE_ANIMAL: Tractor, EXOTICS: Bird, GENERAL: BedDouble };

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

function PatientCard({ a, cage }: { a: Admission; cage?: string }) {
  const c = CONDITION[a.condition] ?? CONDITION.STABLE;
  const overdue = a.overdueTasks ?? 0;
  const dueSoon = a.dueSoonTasks ?? 0;
  return (
    <Link
      href={`/hospital/admissions/${a.id}`}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl bg-card/80 pl-4 pr-3.5 py-3 shadow-sm ring-1 ring-inset ring-foreground/[0.07] transition-all hover:-translate-y-px hover:shadow-md hover:ring-primary/30',
        a.condition === 'CRITICAL' && 'ring-destructive/30',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', c.stripe)} />
      <div className="flex items-start gap-2.5">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-semibold', c.chip)}>{initials(a.patient.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold group-hover:text-primary">{a.patient.name}</p>
            {cage && <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-2xs font-semibold text-muted-foreground">{cage}</span>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {a.patient.species.name} · {a.client.displayName}
          </p>
        </div>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold', c.chip)}>
          {a.condition === 'CRITICAL' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />}
          {c.label}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{a.diagnosis || a.reason}</p>

      {(a.cprStatus !== 'UNDECIDED' || a.isolation || a.patient.alerts.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          <CprBadge status={a.cprStatus} />
          {a.isolation && <IsolationBadge />}
          {a.patient.alerts.slice(0, 2).map((al) => (
            <AlertChip key={al.id} alert={al} />
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-2xs">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">Day {a.daysInHospital}</span>
        {overdue > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
            <AlertOctagon className="h-3 w-3" /> {overdue} overdue
          </span>
        )}
        {dueSoon > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">
            <Clock className="h-3 w-3" /> {dueSoon} due soon
          </span>
        )}
        {a.surgery && (
          <span className="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
            <Scissors className="h-3 w-3 shrink-0" /> <span className="truncate">{a.surgery.procedure}</span>
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 border-t border-foreground/[0.06] pt-2 text-2xs text-muted-foreground">
        {a.responsibleClinician && (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Stethoscope className="h-3 w-3 shrink-0" /> <span className="truncate">{a.responsibleClinician.name}</span>
          </span>
        )}
        <span className={cn('ml-auto flex shrink-0 items-center gap-1', !a.lastVitalsAt && 'text-warning')}>
          <Activity className="h-3 w-3" /> {a.lastVitalsAt ? `Obs ${fmtRelative(a.lastVitalsAt)}` : 'No obs yet'}
        </span>
      </div>
    </Link>
  );
}

function EmptyCage({ name, canAdmit, onAdmit }: { name: string; canAdmit: boolean; onAdmit: () => void }) {
  return (
    <button
      type="button"
      disabled={!canAdmit}
      onClick={onAdmit}
      aria-label={canAdmit ? `${name}: free — admit a patient here` : `${name}: free`}
      className="group flex h-full min-h-[5.25rem] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-foreground/[0.12] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.04] hover:text-primary disabled:cursor-default disabled:hover:border-foreground/[0.12] disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      <span className="text-sm font-semibold text-foreground/70 group-hover:text-primary">{name}</span>
      <span className="flex items-center gap-1 text-2xs">
        {canAdmit ? (
          <>
            <span className="group-hover:hidden">Free</span>
            <span className="hidden items-center gap-1 font-medium group-hover:inline-flex">
              <Plus className="h-3 w-3" /> Admit here
            </span>
          </>
        ) : (
          'Free'
        )}
      </span>
    </button>
  );
}

function Kpi({ icon: Icon, label, value, tone, children }: { icon: LucideIcon; label: string; value: React.ReactNode; tone: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5">
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold leading-tight tabular">{value}</p>
        {children}
      </div>
    </div>
  );
}

function FlowboardView() {
  const { can, session } = useSession();
  const url = useUrlState();
  const [admitCage, setAdmitCage] = useState<string | null | undefined>(undefined);
  const q = useQuery({ queryKey: ['flowboard', session.branch?.id], queryFn: () => api.get<Flowboard>(`/hospital/flowboard${qs({ branchId: session.branch?.id })}`), refetchInterval: 30_000 });
  const ward = url.get('ward', 'all');
  const hideEmpty = url.get('empty') === 'hide';
  const canAdmit = can('hospital.write');

  const header = (
    <PageHeader
      title="Hospital"
      help="hospital"
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {session.branch?.name}
          {q.data && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success" title="Refreshes every 30 seconds">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live · updated {fmtRelative(q.data.generatedAt)}
            </span>
          )}
        </span>
      }
      actions={
        <>
          {can('surgery.read') && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/surgery">
                <Scissors /> Surgery
              </Link>
            </Button>
          )}
          {canAdmit && (
            <Button size="sm" onClick={() => setAdmitCage(null)}>
              <Plus /> Admit patient
            </Button>
          )}
        </>
      }
    />
  );

  if (q.isLoading) return <>{header}<LoadingRows /></>;
  if (q.error || !q.data) return <>{header}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  const d = q.data;
  const byId = (id: string | null) => d.admissions.find((a) => a.id === id);
  const unassigned = d.admissions.filter((a) => !a.cageId);
  const cages = d.wards.flatMap((w) => w.cages);
  const occupied = cages.filter((c) => c.admissionId).length;
  const free = cages.length - occupied;
  const pct = cages.length ? Math.round((occupied / cages.length) * 100) : 0;
  const wards = d.wards.filter((w) => ward === 'all' || w.id === ward);

  return (
    <>
      {header}

      {/* The day at a glance. */}
      <Card className="mb-5 grid grid-cols-2 divide-foreground/[0.06] overflow-hidden p-0 lg:grid-cols-4 lg:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-foreground/[0.06] lg:[&>*:nth-child(-n+2)]:border-b-0">
        <Kpi icon={BedDouble} label="In hospital" value={d.summary.inpatients} tone="bg-primary/10 text-primary" />
        <Kpi icon={Siren} label="Critical" value={d.summary.critical} tone={d.summary.critical ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'} />
        <Kpi icon={AlertOctagon} label="Overdue treatments" value={<span className={cn(d.summary.overdueTasks > 0 && 'text-destructive')}>{d.summary.overdueTasks}</span>} tone={d.summary.overdueTasks ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'} />
        <Kpi icon={Home} label="Cages free" value={<>{free}<span className="text-sm font-normal text-muted-foreground"> of {cages.length}</span></>} tone="bg-success/12 text-success">
          <div className="mt-1.5 h-1 w-full max-w-[9rem] overflow-hidden rounded-full bg-muted" title={`${pct}% occupied`}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </Kpi>
      </Card>

      {!d.wards.length && !d.admissions.length ? (
        <Card>
          <EmptyState icon={BedDouble} title="No wards set up" description="Add your wards and cages in Settings → Hospital wards & cages, then admit patients here." action={can('settings.manage') && <Button size="sm" asChild><Link href="/settings/wards">Set up wards</Link></Button>} />
        </Card>
      ) : (
        <>
          {/* Wards to show, and whether to list free cages. */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Ward">
              {[{ id: 'all', name: 'All wards', n: d.admissions.length }, ...d.wards.map((w) => ({ id: w.id, name: w.name, n: w.cages.filter((c) => c.admissionId).length }))].map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="tab"
                  aria-selected={ward === w.id}
                  onClick={() => url.set({ ward: w.id === 'all' ? null : w.id })}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                    ward === w.id ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {w.name}
                  <span className={cn('rounded-full px-1.5 text-2xs tabular', ward === w.id ? 'bg-primary/15' : 'bg-muted')}>{w.n}</span>
                </button>
              ))}
            </div>
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={hideEmpty} onCheckedChange={(v) => url.set({ empty: v ? 'hide' : null })} aria-label="Hide free cages" />
              Hide free cages
            </label>
          </div>

          <div className="grid gap-4">
            {ward === 'all' && !!unassigned.length && (
              <Card className="p-4 sm:p-5" aria-label="Not in a cage">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-warning/15 text-warning">
                    <BedDouble className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">Not in a cage yet</h2>
                    <p className="text-2xs text-muted-foreground">Open the stay to move them into a cage.</p>
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                  {unassigned.map((a) => (
                    <PatientCard key={a.id} a={a} />
                  ))}
                </div>
              </Card>
            )}
            {wards.map((w) => {
              const used = w.cages.filter((c) => c.admissionId).length;
              const Icon = WARD_ICON[w.type] ?? BedDouble;
              const shown = hideEmpty ? w.cages.filter((c) => c.admissionId) : w.cages;
              const wardPct = w.cages.length ? Math.round((used / w.cages.length) * 100) : 0;
              return (
                <Card key={w.id} className="p-4 sm:p-5" aria-label={w.name}>
                  <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={cn('grid h-8 w-8 place-items-center rounded-xl', w.type === 'ICU' ? 'bg-destructive/10 text-destructive' : w.type === 'ISOLATION' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <h2 className="text-sm font-semibold">{w.name}</h2>
                    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className={cn('h-full rounded-full', wardPct >= 100 ? 'bg-destructive' : wardPct >= 75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${wardPct}%` }} />
                      </div>
                      <span className="tabular">
                        {used}/{w.cages.length} occupied
                      </span>
                    </div>
                    {canAdmit && used < w.cages.length && (
                      <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => setAdmitCage(w.cages.find((c) => !c.admissionId)!.id)}>
                        <Plus className="h-3.5 w-3.5" /> Admit to {w.name}
                      </Button>
                    )}
                  </div>
                  {shown.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                      {shown.map((c) => {
                        const a = byId(c.admissionId);
                        return a ? <PatientCard key={c.id} a={a} cage={c.name} /> : <EmptyCage key={c.id} name={c.name} canAdmit={canAdmit} onAdmit={() => setAdmitCage(c.id)} />;
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground">No patients in this ward · {w.cages.length} free cage{w.cages.length === 1 ? '' : 's'}</p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
      <AdmitDialog open={admitCage !== undefined} onOpenChange={(o) => !o && setAdmitCage(undefined)} cageId={admitCage ?? null} />
    </>
  );
}

export default function HospitalPage() {
  return (
    <RequirePermission anyOf={['hospital.read']}>
      <Suspense>
        <FlowboardView />
      </Suspense>
    </RequirePermission>
  );
}
