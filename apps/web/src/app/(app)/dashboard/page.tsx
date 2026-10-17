'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, BedDouble, Boxes, CalendarClock, CalendarDays, CheckSquare, FileWarning, ListChecks, PawPrint, Receipt, Scissors, Stethoscope, Tractor, UserPlus, Users, Wallet } from 'lucide-react';
import { enumLabel } from '@vcms/shared';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { branchTime, localDate } from '@/lib/time';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { AttentionList, buildAttention } from '@/components/dashboard/attention';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { SetupChecklist } from '@/components/dashboard/setup-checklist';
import { Stat } from '@/components/stat';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney, fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface DashboardData {
  generatedAt: string;
  widgets: {
    registrations?: { activeClients: number; activePatients: number; newClients: number; newPatients: number; species: { name: string; count: number }[] };
    recentPatients?: { id: string; name: string; patientNo: string; species: string; owner: { id: string; displayName: string } | null; createdAt: string }[];
    criticalAlerts?: { id: string; title: string; type: string; patient: { id: string; name: string }; createdAt: string }[];
    appointmentsToday?: {
      total: number;
      byStatus: Record<string, number>;
      emergencies: number;
      upcoming: { id: string; startsAt: string; status: string; priority: string | null; patient: { id: string; name: string } | null; type: { name: string; color: string }; clinician: string | null }[];
    };
    clinicalWork?: { openEncounters: number; unsignedNotes: { id: string; encounterId: string; encounterNo: string; patient: string; updatedAt: string; status: string }[] };
    pharmacy?: { awaitingAuthorization: number; readyToDispense: number };
    lab?: { toCollect: number; inProgress: number; awaitingValidation: number; critical: { id: string; orderNo: string; patient: { id: string; name: string }; status: string }[] };
    hospital?: { inpatients: number; overdueTreatments: number; critical: { id: string; admissionNo: string; patient: { id: string; name: string } }[] };
    surgery?: { today: { id: string; surgeryNo: string; procedure: string; status: string; scheduledAt: string; patient: { id: string; name: string }; theatre: string | null }[] };
    preventive?: { overdue: number; dueThisWeek: number };
    communications?: { unreadMessages: number; pendingRequests: number; failedMessages: number };
    finance?: { billedTodayMinor: number; receivedTodayMinor: number; outstandingMinor: number; overdueInvoices: number; unbilledCount: number; unbilledMinor: number };
    inventory?: { lowStockCount: number; lowStock: { id: string; name: string; available: number; reorderLevel: number | null; unit: string }[]; expiringCount: number; expiring: { id: string; name: string; nextExpiry: string | null }[]; valueMinor: number };
    livestock?: { visitsToday: { id: string; visitNo: string; farm: { id: string; name: string }; purpose: string; status: string; scheduledAt: string }[]; openOutbreaks: number; animalsUnderWithdrawal: number; birthsDue14Days: number };
    boarding?: { inHouse: number; arrivingToday: number; departingToday: number; grooming: { waiting: number; inProgress: number; ready: number } };
    insurance?: { claimsAwaitingDecision: number; claimsQueried: number; insurerOwedMinor: number; openReferrals: number };
    tasks?: { dueOrOverdue: { id: string; title: string; type: string; dueAt: string; overdue: boolean; patient: { id: string; name: string } | null }[] };
  };
}

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

export default function DashboardPage() {
  const { session, currency, can } = useSession();
  const portal = session.features?.clientPortal === true;
  const [days, setDays] = useState('30');
  const [scope, setScope] = useState<'branch' | 'all'>('all');
  // Day-granular so the query key is stable between renders.
  const from = new Date(new Date().setHours(0, 0, 0, 0) - Number(days) * 86400_000).toISOString();
  const branchId = scope === 'branch' ? session.branch?.id : undefined;

  const q = useQuery({
    queryKey: ['dashboard', days, branchId],
    queryFn: () => api.get<DashboardData>(`/dashboard${qs({ from, branchId })}`),
    refetchInterval: 60_000,
  });
  const w = q.data?.widgets;
  const rangeLabel = RANGES.find((r) => r.value === days)?.label.toLowerCase();

  const money = (m: number) => fmtMoney(m, currency);
  const attention = w ? buildAttention(w, { money, portal, can: (p) => can(p as never) }) : [];
  const appts = w?.appointmentsToday;
  const glance = [
    appts && { label: 'Appointments', value: appts.total, hint: `${appts.byStatus.COMPLETED ?? 0} done`, icon: CalendarDays, href: '/calendar' },
    appts && { label: 'Waiting', value: appts.byStatus.CHECKED_IN ?? 0, icon: Users, href: '/front-desk', tone: (appts.byStatus.CHECKED_IN ?? 0) ? 'warning' : undefined },
    w?.clinicalWork && { label: 'Open consults', value: w.clinicalWork.openEncounters, icon: Stethoscope, href: '/consultations' },
    w?.hospital && { label: 'In hospital', value: w.hospital.inpatients, icon: BedDouble, href: '/hospital' },
    w?.surgery && { label: 'Surgeries', value: w.surgery.today.length, icon: Scissors, href: '/surgery' },
    w?.boarding && { label: 'Boarders in', value: w.boarding.inHouse, icon: BedDouble, href: '/boarding' },
    w?.livestock && { label: 'Farm visits', value: w.livestock.visitsToday.length, icon: Tractor, href: '/livestock?tab=visits' },
    w?.finance && { label: 'Received today', value: money(w.finance.receivedTodayMinor), icon: Wallet, href: '/billing/payments' },
  ].filter(Boolean) as { label: string; value: number | string; hint?: string; icon: React.ComponentType<{ className?: string }>; href: string; tone?: 'warning' }[];
  const insights = !!(w?.finance || w?.inventory || w?.registrations);
  // One row per patient, however many critical alerts they carry.
  const alertsByPatient = Object.values(
    (w?.criticalAlerts ?? []).reduce<Record<string, { patient: { id: string; name: string }; titles: string[] }>>((acc, a) => {
      (acc[a.patient.id] ??= { patient: a.patient, titles: [] }).titles.push(a.title);
      return acc;
    }, {}),
  );
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${session.user.name.split(' ')[0] === 'Dr.' ? session.user.name.split(' ').slice(0, 2).join(' ') : session.user.name.split(' ')[0]}`}
        description={`${today} · ${session.organization?.name}${session.branch ? ` · ${session.branch.name}` : ''}`}
      />

      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-5">
          <QuickActions />
          <SetupChecklist />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <AttentionList items={attention} />
            {glance.length > 0 && (
              <section aria-label="Today at a glance" className="grid content-start gap-2 rounded-lg border bg-card p-3 shadow-sm">
                <h2 className="px-1 text-sm font-semibold">Today at a glance</h2>
                <ul className="grid grid-cols-2 gap-2">
                  {glance.map((g) => (
                    <li key={g.label}>
                      <Link href={g.href} className="flex h-full items-center gap-2.5 rounded-md border bg-background px-2.5 py-2 transition-colors hover:border-primary/50 hover:bg-primary/5">
                        <g.icon className={cn('h-4 w-4 shrink-0', g.tone === 'warning' ? 'text-warning' : 'text-muted-foreground')} />
                        <span className="min-w-0">
                          <span className="block text-lg font-semibold leading-tight tabular">{g.value}</span>
                          <span className="block truncate text-2xs text-muted-foreground" title={g.hint ? `${g.label} · ${g.hint}` : g.label}>{g.label}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {(w?.appointmentsToday || w?.clinicalWork || w?.tasks || (w?.surgery && w.surgery.today.length > 0)) && (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {w.appointmentsToday && (
                <Card>
                  <CardHeader>
                    <CardTitle>Next appointments</CardTitle>
                    <Link href="/calendar" className="text-xs text-primary hover:underline">Calendar</Link>
                  </CardHeader>
                  {w.appointmentsToday.upcoming.length ? (
                    <ul className="divide-y">
                      {w.appointmentsToday.upcoming.map((a) => (
                        <li key={a.id}>
                          <Link href={`/calendar?date=${localDate(a.startsAt, session.branch?.timezone ?? 'UTC')}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                            <span className="w-11 text-sm font-medium tabular">{branchTime(a.startsAt, session.branch?.timezone ?? 'UTC')}</span>
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.type.color }} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{a.patient?.name ?? 'No patient'}</span>
                              <span className="block truncate text-xs text-muted-foreground">{a.type.name}{a.clinician && ` · ${a.clinician}`}</span>
                            </span>
                            <PriorityDot priority={a.priority} />
                            <span className="text-2xs text-muted-foreground">{enumLabel(a.status)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No more appointments today" className="py-8" action={<Link href="/calendar" className="text-sm font-medium text-primary hover:underline">Open the calendar</Link>} />
                  )}
                </Card>
              )}
              {w.clinicalWork && w.clinicalWork.unsignedNotes.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileWarning className="h-4 w-4 text-warning" /> My unsigned notes</CardTitle>
                  </CardHeader>
                  <ul className="divide-y">
                    {w.clinicalWork.unsignedNotes.map((n) => (
                      <li key={n.id}>
                        <Link href={`/consultations/${n.encounterId}`} className="flex items-center justify-between px-4 py-2 hover:bg-muted/50">
                          <span className="text-sm">{n.patient} <span className="text-xs text-muted-foreground">{n.encounterNo}</span></span>
                          <span className="text-xs text-muted-foreground">{fmtRelative(n.updatedAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {w.tasks && (
                <Card id="follow-ups">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-muted-foreground" /> Follow-ups due</CardTitle>
                  </CardHeader>
                  {w.tasks.dueOrOverdue.length ? (
                    <ul className="divide-y">
                      {w.tasks.dueOrOverdue.map((t) => (
                        <li key={t.id} className="px-4 py-2">
                          <p className="text-sm">{t.title}</p>
                          <p className={`text-xs ${t.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                            {t.overdue ? 'Overdue' : 'Due'} {fmtDate(t.dueAt)}
                            {t.patient && <> · <Link className="hover:underline" href={`/patients/${t.patient.id}`}>{t.patient.name}</Link></>}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No follow-ups due" className="py-8" />
                  )}
                </Card>
              )}
              {w.surgery && w.surgery.today.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Scissors className="h-4 w-4 text-muted-foreground" /> Surgery today</CardTitle>
                    <Link href="/surgery" className="text-xs text-primary hover:underline">Theatre list</Link>
                  </CardHeader>
                  <ul className="divide-y">
                    {w.surgery.today.map((sx) => (
                      <li key={sx.id}>
                        <Link href={`/surgery/${sx.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50">
                          <span className="w-11 text-sm font-medium tabular">{branchTime(sx.scheduledAt, session.branch?.timezone ?? 'UTC')}</span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{sx.patient.name} · {sx.procedure}</span><span className="block text-xs text-muted-foreground">{sx.theatre ?? 'No theatre'}</span></span>
                          <span className="text-2xs text-muted-foreground">{enumLabel(sx.status)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {w.criticalAlerts && w.criticalAlerts.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-destructive" /> Critical patient alerts</CardTitle>
                  </CardHeader>
                  <ul className="divide-y">
                    {alertsByPatient.slice(0, 5).map((g) => (
                      <li key={g.patient.id}>
                        <Link href={`/patients/${g.patient.id}`} className="block px-4 py-2.5 hover:bg-muted/50">
                          <p className="text-sm font-medium">{g.patient.name}{g.titles.length > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{g.titles.length} alerts</span>}</p>
                          <p className="truncate text-xs text-destructive">{g.titles.join(' · ')}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {alertsByPatient.length > 5 && <p className="border-t px-4 py-2 text-xs text-muted-foreground">+{alertsByPatient.length - 5} more patients — alerts show in red on each patient’s record</p>}
                </Card>
              )}
            </div>
          )}

          {insights && (
            <section aria-label="Business insights" className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-4">
                <div>
                  <h2 className="text-base font-semibold">Business insights</h2>
                  <p className="text-xs text-muted-foreground">Money, stock and registrations · {rangeLabel}</p>
                </div>
                <div className="flex gap-2">
                  <NativeSelect aria-label="Branch scope" className="h-8 w-[170px] text-xs" value={scope} onChange={(e) => setScope(e.target.value as 'branch' | 'all')}>
                    <option value="all">All branches</option>
                    <option value="branch">{session.branch?.name ?? 'Current branch'}</option>
                  </NativeSelect>
                  <NativeSelect aria-label="Date range" className="h-8 w-[150px] text-xs" value={days} onChange={(e) => setDays(e.target.value)}>
                    {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </NativeSelect>
                </div>
              </div>

              {w?.finance && (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <Stat label="Billed today" value={money(w.finance.billedTodayMinor)} icon={Receipt} href="/billing?tab=all" />
                  <Stat label="Received today" value={money(w.finance.receivedTodayMinor)} icon={Wallet} href="/billing/payments" tone="success" />
                  <Stat label="Outstanding" value={money(w.finance.outstandingMinor)} icon={Receipt} href="/billing" hint={w.finance.overdueInvoices ? `${w.finance.overdueInvoices} overdue invoice${w.finance.overdueInvoices === 1 ? '' : 's'}` : 'None overdue'} tone={w.finance.overdueInvoices ? 'warning' : 'default'} />
                  <Stat label="Unbilled charges" value={w.finance.unbilledCount} icon={ListChecks} href="/billing/charges" hint={`${money(w.finance.unbilledMinor)} before tax`} tone={w.finance.unbilledCount ? 'warning' : 'default'} />
                </div>
              )}

              {w?.inventory && (
                <div className="grid gap-4 xl:grid-cols-3">
                  <Stat label="Stock value at cost" value={money(w.inventory.valueMinor)} icon={Boxes} href="/inventory" hint={`${w.inventory.lowStockCount} low · ${w.inventory.expiringCount} expiring within 60 days`} />
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Low stock</CardTitle>
                      <Link href="/inventory?filter=low" className="text-xs text-primary hover:underline">View all</Link>
                    </CardHeader>
                    {w.inventory.lowStock.length ? (
                      <ul className="divide-y">
                        {w.inventory.lowStock.map((p) => (
                          <li key={p.id}>
                            <Link href={`/inventory/products/${p.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-muted/50">
                              <span className="truncate">{p.name}</span>
                              <span className="tabular text-destructive">{p.available} / {p.reorderLevel} {p.unit}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <EmptyState title="Nothing below reorder level" className="py-6" />}
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-warning" /> Expiring soon</CardTitle>
                      <Link href="/inventory?filter=exp90" className="text-xs text-primary hover:underline">View all</Link>
                    </CardHeader>
                    {w.inventory.expiring.length ? (
                      <ul className="divide-y">
                        {w.inventory.expiring.map((p) => (
                          <li key={p.id}>
                            <Link href={`/inventory/products/${p.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-muted/50">
                              <span className="truncate">{p.name}</span>
                              <span className="text-warning">{fmtDate(p.nextExpiry)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : <EmptyState title="No stock expiring within 60 days" className="py-6" />}
                  </Card>
                </div>
              )}

              {w?.registrations && (
                <>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <Stat label="Active clients" value={w.registrations.activeClients.toLocaleString()} hint="On file now" icon={Users} href="/clients" />
                    <Stat label="Active patients" value={w.registrations.activePatients.toLocaleString()} hint="On file now" icon={PawPrint} href="/patients" />
                    <Stat label="Clients registered" value={w.registrations.newClients.toLocaleString()} hint={`${rangeLabel} · incl. since archived`} icon={UserPlus} tone="success" />
                    <Stat label="Patients registered" value={w.registrations.newPatients.toLocaleString()} hint={`${rangeLabel} · incl. since archived`} icon={PawPrint} tone="success" />
                  </div>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <Card className="xl:col-span-2">
                      <CardHeader><CardTitle>Active patients by species</CardTitle></CardHeader>
                      <CardContent className="h-[240px]">
                        {w.registrations.species.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={w.registrations.species.slice(0, 10)} margin={{ left: -20 }}>
                              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} tickLine={false} axisLine={false} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                              <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                              <Bar dataKey="count" name="Patients" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <EmptyState title="No patients yet" description="Register a patient to see the species mix." />
                        )}
                      </CardContent>
                    </Card>
                    {w.recentPatients && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Recently registered</CardTitle>
                          <Link href="/patients?sort=-createdAt" className="text-xs text-primary hover:underline">View all</Link>
                        </CardHeader>
                        {w.recentPatients.length ? (
                          <ul className="divide-y">
                            {w.recentPatients.slice(0, 6).map((p) => (
                              <li key={p.id}>
                                <Link href={`/patients/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-muted/50">
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{p.name} <span className="font-normal text-muted-foreground">· {p.species}</span></span>
                                    <span className="block truncate text-xs text-muted-foreground">{p.owner?.displayName ?? 'No owner'}</span>
                                  </span>
                                  <span className="shrink-0 text-xs text-muted-foreground" title={fmtDate(p.createdAt)}>{fmtRelative(p.createdAt)}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : <EmptyState title="No patients registered yet" />}
                      </Card>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
          <p className="text-right text-2xs text-muted-foreground">Updated {fmtRelative(q.data?.generatedAt)} · refreshes every minute</p>
        </div>
      )}
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
