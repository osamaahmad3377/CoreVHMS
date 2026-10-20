'use client';
import { useQuery } from '@tanstack/react-query';
import { COUNTRIES, type ClinicOverview } from '@vcms/shared';
import { AlertTriangle, CalendarDays, Clock, ExternalLink, History, KeyRound, Loader2, PauseCircle, PawPrint, Play, RotateCcw, UserCheck, Users } from 'lucide-react';
import { use, useState } from 'react';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { ClinicPlanCard } from '@/components/platform/clinic-plan-card';
import { ClinicActionsMenu, CopyButton, OwnerAccessDialog, StatusBadge, shortAddress, useClinicActions, type OwnerAccess } from '@/components/platform/clinic-ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';

/** Plain words for the platform's history of a clinic. */
const EVENT_LABELS: Record<string, string> = {
  'platform.clinic_created': 'Clinic added',
  'platform.clinic_ready': 'Set-up finished — ready to use',
  'platform.clinic_setup_retried': 'Set-up tried again',
  'platform.clinic_suspended': 'Paused',
  'platform.clinic_reactivated': 'Reactivated',
  'platform.clinic_owner_password_reset': 'New owner password created',
  'platform.clinic_added_existing': 'Existing database added',
  'platform.clinic_plan_changed': 'Plan changed',
};

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-lg font-semibold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ''}</span>
      </span>
    </div>
  );
}

export default function PlatformClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [access, setAccess] = useState<OwnerAccess | null>(null);
  const { run, pending } = useClinicActions(setAccess);
  const q = useQuery({
    queryKey: ['platform-clinic', id],
    queryFn: () => api.get<ClinicOverview>(`/platform/clinics/${id}/overview`),
    refetchInterval: (query) => (query.state.data?.clinic.status === 'PROVISIONING' ? 3000 : false),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { clinic: c, usage, events } = q.data;
  const busy = pending?.id === c.id;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Clinics', href: '/platform' }, { label: c.name }]}
        title={<span className="flex flex-wrap items-center gap-2">{c.name} <StatusBadge status={c.status} /></span>}
        description={`${COUNTRIES.find((x) => x.code === c.country)?.name ?? c.country} · ${c.planName ? `${c.planName} plan` : 'no plan'} · added ${fmtDate(c.createdAt)}`}
        actions={
          <>
            {c.status === 'ACTIVE' && <Button asChild variant="outline"><a href={`${c.address}/login`} target="_blank" rel="noreferrer"><ExternalLink /> Open sign-in page</a></Button>}
            <ClinicActionsMenu clinic={c} run={run} />
          </>
        }
      />

      {c.status === 'PROVISIONING' && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-info/30 bg-info/5 p-4 text-sm">
          <Loader2 className="h-5 w-5 animate-spin text-info" />
          <span>Creating the clinic’s database and setting it up. This page updates by itself — usually under a minute.</span>
        </div>
      )}
      {c.status === 'FAILED' && (
        <div className="mb-4 grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Set-up did not finish</p>
          {c.lastError && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-card p-2 font-mono text-xs">{c.lastError}</pre>}
          <p className="text-muted-foreground">Common causes: the database server was busy, or the database user may not create databases. Each step is safe to repeat.</p>
          <div><Button loading={busy} onClick={() => run(c, 'retry')}><RotateCcw /> Try set-up again</Button></div>
        </div>
      )}
      {c.status === 'SUSPENDED' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
          <span className="flex items-center gap-2"><PauseCircle className="h-5 w-5 text-warning" /> Paused {c.suspendedAt ? `on ${fmtDateTime(c.suspendedAt)}` : ''}. Nobody at this clinic can sign in. No data has been deleted.</span>
          <Button loading={busy} onClick={() => run(c, 'reactivate')}><Play /> Reactivate</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="grid content-start gap-4">
          {usage && (
            <Card>
              <CardHeader><CardTitle>How it is used</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                <Stat icon={<Users className="h-4 w-4" />} label="Staff" value={usage.activeStaff} sub={usage.staff > usage.activeStaff ? `${usage.staff - usage.activeStaff} invited or paused` : undefined} />
                <Stat icon={<UserCheck className="h-4 w-4" />} label="Clients" value={usage.clients.toLocaleString()} />
                <Stat icon={<PawPrint className="h-4 w-4" />} label="Patients" value={usage.patients.toLocaleString()} />
                <Stat icon={<CalendarDays className="h-4 w-4" />} label="Appointments this month" value={usage.appointmentsThisMonth.toLocaleString()} />
                <Stat icon={<Clock className="h-4 w-4" />} label="Last sign-in" value={usage.lastSignInAt ? fmtRelative(usage.lastSignInAt) : 'Nobody yet'} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> History</CardTitle></CardHeader>
            <CardContent>
              {events.length ? (
                <ol className="grid gap-3 border-l pl-4">
                  {events.map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                      <p className="font-medium">{EVENT_LABELS[e.action] ?? e.action}</p>
                      {e.action === 'platform.clinic_plan_changed' && e.summary && <p className="text-xs">{e.summary}</p>}
                      <p className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ''}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* On phones the sign-in details come first: they are what the super admin usually needs. */}
        <div className="order-first grid content-start gap-4 lg:order-none">
          <Card>
            <CardHeader><CardTitle>Sign-in details</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Web address</p>
                <div className="flex items-center gap-1"><span className="break-all font-medium">{shortAddress(c.address)}</span><CopyButton text={c.address} what="Address" /></div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Owner</p>
                <p className="font-medium">{c.ownerName}</p>
                <div className="flex items-center gap-1"><span className="break-all">{c.ownerEmail}</span><CopyButton text={c.ownerEmail} what="Email" /></div>
              </div>
              <p className="text-xs text-muted-foreground">{c.ownerAccess === 'INVITATION' ? 'The owner was emailed a link to choose a password.' : 'The owner was given a temporary password.'}</p>
              {c.status === 'ACTIVE' && (
                <Button variant="outline" loading={busy} onClick={() => run(c, 'owner-password')}><KeyRound /> Owner can’t sign in? New password</Button>
              )}
            </CardContent>
          </Card>
          {(c.status === 'ACTIVE' || c.status === 'SUSPENDED') && (
            // Keyed on the saved plan, so the form restarts from what was saved.
            <ClinicPlanCard key={JSON.stringify([c.planId, c.staffLimitOverride, c.branchLimitOverride, c.extraFeatures, c.removedFeatures])} overview={q.data} />
          )}
          <Card>
            <CardHeader><CardTitle>Technical details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Database</dt><dd className="font-mono text-xs">{c.databaseName}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Ready since</dt><dd>{c.provisionedAt ? fmtDateTime(c.provisionedAt) : '—'}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
      <OwnerAccessDialog result={access} onClose={() => setAccess(null)} />
    </>
  );
}
