'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, BedDouble, Clock, Plus, Scissors, Siren, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AdmitDialog } from '@/components/hospital/admit-dialog';
import { ConditionBadge, CprBadge, IsolationBadge } from '@/components/hospital/badges';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Stat } from '@/components/stat';
import { AlertChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, qs } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Admission, Flowboard } from '@/lib/types';
import { cn } from '@/lib/utils';

function PatientCard({ a }: { a: Admission }) {
  return (
    <Link
      href={`/hospital/admissions/${a.id}`}
      className={cn('group flex h-full flex-col gap-2 rounded-xl surface-flat p-3 shadow-card transition-colors hover:border-primary/50', a.condition === 'CRITICAL' && 'border-destructive/50 ring-1 ring-destructive/30', (a.overdueTasks ?? 0) > 0 && 'border-destructive/40')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold group-hover:underline">{a.patient.name}</p>
          <p className="truncate text-xs text-muted-foreground">{a.patient.species.name} · {a.client.displayName}</p>
        </div>
        <ConditionBadge condition={a.condition} />
      </div>
      <div className="flex flex-wrap gap-1">
        <CprBadge status={a.cprStatus} />
        {a.isolation && <IsolationBadge />}
        {a.patient.alerts.slice(0, 2).map((al) => <AlertChip key={al.id} alert={al} />)}
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{a.reason}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>Day {a.daysInHospital}</span>
        {a.responsibleClinician && <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{a.responsibleClinician.name}</span>}
        {(a.overdueTasks ?? 0) > 0 && <span className="flex items-center gap-1 font-semibold text-destructive"><AlertOctagon className="h-3 w-3" />{a.overdueTasks} overdue</span>}
        {(a.dueSoonTasks ?? 0) > 0 && <span className="flex items-center gap-1 text-warning"><Clock className="h-3 w-3" />{a.dueSoonTasks} due soon</span>}
        {a.surgery && <span className="flex items-center gap-1"><Scissors className="h-3 w-3" />{a.surgery.procedure}</span>}
        <span>Obs {a.lastVitalsAt ? fmtRelative(a.lastVitalsAt) : 'none yet'}</span>
      </div>
    </Link>
  );
}

function FlowboardView() {
  const { can, session } = useSession();
  const [admitCage, setAdmitCage] = useState<string | null | undefined>(undefined);
  const q = useQuery({ queryKey: ['flowboard', session.branch?.id], queryFn: () => api.get<Flowboard>(`/hospital/flowboard${qs({ branchId: session.branch?.id })}`), refetchInterval: 30_000 });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const byId = (id: string | null) => d.admissions.find((a) => a.id === id);
  const unassigned = d.admissions.filter((a) => !a.cageId);
  return (
    <>
      <PageHeader
        title="Hospital"
        help="hospital"
        description={`${session.branch?.name ?? ''} · updated ${fmtRelative(d.generatedAt)} · refreshes every 30 seconds`}
        actions={
          <>
            {can('surgery.read') && <Button size="sm" variant="outline" asChild><Link href="/surgery"><Scissors /> Surgery</Link></Button>}
            {can('hospital.write') && <Button size="sm" onClick={() => setAdmitCage(null)}><Plus /> Admit patient</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="In hospital" value={d.summary.inpatients} icon={BedDouble} />
        <Stat label="Critical" value={d.summary.critical} icon={Siren} tone={d.summary.critical ? 'danger' : 'default'} />
        <Stat label="Overdue treatments" value={d.summary.overdueTasks} icon={AlertOctagon} tone={d.summary.overdueTasks ? 'danger' : 'default'} />
      </div>
      {!d.wards.length && !d.admissions.length && (
        <Card>
          <EmptyState icon={BedDouble} title="No wards set up" description="Add your wards and cages in Settings → Hospital wards & cages, then admit patients here." action={can('settings.manage') && <Button size="sm" asChild><Link href="/settings/wards">Set up wards</Link></Button>} />
        </Card>
      )}
      <div className="grid gap-5">
        {d.wards.map((w) => (
          <section key={w.id} aria-label={w.name}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">{w.name} <span className="text-xs font-normal text-muted-foreground">{w.cages.filter((c) => c.admissionId).length}/{w.cages.length} occupied</span></h2>
            <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {w.cages.map((c) => {
                const a = byId(c.admissionId);
                return (
                  <div key={c.id} className="grid content-start gap-1">
                    <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{c.name}</span>
                    {a ? (
                      <PatientCard a={a} />
                    ) : (
                      <button
                        type="button"
                        disabled={!can('hospital.write')}
                        onClick={() => setAdmitCage(c.id)}
                        className="flex min-h-[64px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:hover:bg-transparent"
                      >
                        Empty{can('hospital.write') ? ' — admit here' : ''}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {!!unassigned.length && (
          <section aria-label="Not in a cage">
            <h2 className="mb-2 text-sm font-semibold">Not assigned to a cage</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{unassigned.map((a) => <PatientCard key={a.id} a={a} />)}</div>
          </section>
        )}
      </div>
      <AdmitDialog open={admitCage !== undefined} onOpenChange={(o) => !o && setAdmitCage(undefined)} cageId={admitCage ?? null} />
    </>
  );
}

export default function HospitalPage() {
  return (
    <RequirePermission anyOf={['hospital.read']}>
      <FlowboardView />
    </RequirePermission>
  );
}
