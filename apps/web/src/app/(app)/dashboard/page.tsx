'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, Baby, BedDouble, CalendarPlus, FileText, MessageSquare, Scissors, ShieldAlert, ShieldCheck, Syringe, Tractor, Boxes, CalendarClock, CalendarDays, FlaskConical, ListChecks, Pill, CheckSquare, FileWarning, PawPrint, Receipt, Siren, Stethoscope, UserPlus, Users, Wallet } from 'lucide-react';
import { enumLabel } from '@vcms/shared';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { branchTime } from '@/lib/time';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
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
  const { session, currency } = useSession();
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

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${session.user.name.split(' ')[0] === 'Dr.' ? session.user.name.split(' ').slice(0, 2).join(' ') : session.user.name.split(' ')[0]}`}
        description={`${session.organization?.name}${session.branch ? ` · ${session.branch.name}` : ''}`}
        actions={
          <>
            <NativeSelect aria-label="Branch scope" className="h-8 w-[170px] text-xs" value={scope} onChange={(e) => setScope(e.target.value as 'branch' | 'all')}>
              <option value="all">All branches</option>
              <option value="branch">{session.branch?.name ?? 'Current branch'}</option>
            </NativeSelect>
            <NativeSelect aria-label="Date range" className="h-8 w-[150px] text-xs" value={days} onChange={(e) => setDays(e.target.value)}>
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </>
        }
      />

      {q.isLoading ? (
        <LoadingRows rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4">
          <QuickActions />
          <SetupChecklist />
          {(w?.appointmentsToday || w?.clinicalWork) && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {w.appointmentsToday && (
                <>
                  <Stat label="Appointments today" value={w.appointmentsToday.total} icon={CalendarDays} href="/calendar" hint={`${w.appointmentsToday.byStatus.COMPLETED ?? 0} completed`} />
                  <Stat label="Waiting / checked in" value={w.appointmentsToday.byStatus.CHECKED_IN ?? 0} icon={Users} href="/front-desk" tone={(w.appointmentsToday.byStatus.CHECKED_IN ?? 0) ? 'warning' : 'default'} />
                  <Stat label="Emergencies in clinic" value={w.appointmentsToday.emergencies} icon={Siren} href="/front-desk" tone={w.appointmentsToday.emergencies ? 'danger' : 'default'} />
                </>
              )}
              {w.clinicalWork && <Stat label="Open consultations" value={w.clinicalWork.openEncounters} icon={Stethoscope} href="/consultations" />}
            </div>
          )}
          {(w?.appointmentsToday || w?.clinicalWork || w?.tasks) && (
            <div className="grid gap-4 xl:grid-cols-3">
              {w.appointmentsToday && (
                <Card>
                  <CardHeader>
                    <CardTitle>Next appointments</CardTitle>
                    <Link href="/calendar" className="text-xs text-primary hover:underline">Calendar</Link>
                  </CardHeader>
                  {w.appointmentsToday.upcoming.length ? (
                    <ul className="divide-y">
                      {w.appointmentsToday.upcoming.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                          <span className="w-11 text-sm font-medium tabular">{branchTime(a.startsAt, session.branch?.timezone ?? 'UTC')}</span>
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.type.color }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{a.patient?.name ?? 'No patient'}</span>
                            <span className="block truncate text-xs text-muted-foreground">{a.type.name}{a.clinician && ` · ${a.clinician}`}</span>
                          </span>
                          <PriorityDot priority={a.priority} />
                          <span className="text-2xs text-muted-foreground">{enumLabel(a.status)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState title="No more appointments today" className="py-8" />
                  )}
                </Card>
              )}
              {w.clinicalWork && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><FileWarning className="h-4 w-4 text-warning" /> My unsigned notes</CardTitle>
                  </CardHeader>
                  {w.clinicalWork.unsignedNotes.length ? (
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
                  ) : (
                    <EmptyState title="All your notes are signed" className="py-8" />
                  )}
                </Card>
              )}
              {w.tasks && (
                <Card>
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
                    <EmptyState title="Nothing due" className="py-8" />
                  )}
                </Card>
              )}
            </div>
          )}

          {(w?.pharmacy || w?.lab) && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              {w.pharmacy && <Stat label="Prescriptions to authorise" value={w.pharmacy.awaitingAuthorization} icon={Pill} href="/pharmacy?status=DRAFT" tone={w.pharmacy.awaitingAuthorization ? 'warning' : 'default'} />}
              {w.pharmacy && <Stat label="Ready to dispense" value={w.pharmacy.readyToDispense} icon={Pill} href="/pharmacy" />}
              {w.lab && <Stat label="Samples to collect" value={w.lab.toCollect} icon={FlaskConical} href="/lab?tab=ORDERED" />}
              {w.lab && <Stat label="Results awaiting validation" value={w.lab.awaitingValidation} icon={FlaskConical} href="/lab?tab=AWAITING_VALIDATION" tone={w.lab.awaitingValidation ? 'warning' : 'default'} />}
              {w.lab && <Stat label="Critical results (7 days)" value={w.lab.critical.length} icon={AlertOctagon} href="/lab?tab=critical" tone={w.lab.critical.length ? 'danger' : 'default'} />}
            </div>
          )}

          {(w?.preventive || w?.communications) && (
            <div className={cn('grid grid-cols-2 gap-3', portal ? 'xl:grid-cols-5' : 'xl:grid-cols-3')}>
              {w.preventive && <Stat label="Preventive care overdue" value={w.preventive.overdue} icon={Syringe} href="/preventive?range=overdue" tone={w.preventive.overdue ? 'warning' : 'default'} />}
              {w.preventive && <Stat label="Care due this week" value={w.preventive.dueThisWeek} icon={Syringe} href="/preventive?range=week" />}
              {portal && w.communications && <Stat label="Unread client messages" value={w.communications.unreadMessages} icon={MessageSquare} href="/communications?tab=inbox" tone={w.communications.unreadMessages ? 'warning' : 'default'} />}
              {portal && w.communications && <Stat label="Online appointment requests" value={w.communications.pendingRequests} icon={CalendarPlus} href="/communications?tab=requests" tone={w.communications.pendingRequests ? 'warning' : 'default'} />}
              {w.communications && <Stat label="Failed messages (7 days)" value={w.communications.failedMessages} icon={AlertTriangle} href="/communications?status=FAILED" tone={w.communications.failedMessages ? 'danger' : 'default'} />}
            </div>
          )}

          {(w?.livestock || w?.boarding || w?.insurance) && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {w.livestock && <Stat label="Farm visits today" value={w.livestock.visitsToday.length} icon={Tractor} href="/livestock?tab=visits" hint={w.livestock.visitsToday.slice(0, 2).map((v) => v.farm.name).join(', ') || undefined} />}
              {w.livestock && <Stat label="Animals under withdrawal" value={w.livestock.animalsUnderWithdrawal} icon={ShieldAlert} href="/livestock?tab=withdrawals" tone={w.livestock.animalsUnderWithdrawal ? 'warning' : 'default'} />}
              {w.livestock && <Stat label="Births due (14 days)" value={w.livestock.birthsDue14Days} icon={Baby} href="/livestock?tab=births" />}
              {w.livestock && <Stat label="Open disease outbreaks" value={w.livestock.openOutbreaks} icon={AlertTriangle} href="/livestock?tab=outbreaks" tone={w.livestock.openOutbreaks ? 'danger' : 'default'} />}
              {w.boarding && <Stat label="Boarders in" value={w.boarding.inHouse} icon={BedDouble} href="/boarding" hint={`${w.boarding.arrivingToday} arriving · ${w.boarding.departingToday} going home`} />}
              {w.boarding && <Stat label="Grooming" value={w.boarding.grooming.waiting + w.boarding.grooming.inProgress} icon={Scissors} href="/boarding?tab=grooming" hint={w.boarding.grooming.ready ? `${w.boarding.grooming.ready} ready for collection` : undefined} />}
              {w.insurance && <Stat label="Claims awaiting insurer" value={w.insurance.claimsAwaitingDecision} icon={FileText} href="/insurance?tab=claims&status=SUBMITTED" hint={w.insurance.claimsQueried ? `${w.insurance.claimsQueried} queried` : undefined} tone={w.insurance.claimsQueried ? 'warning' : 'default'} />}
              {w.insurance && <Stat label="Owed by insurers" value={fmtMoney(w.insurance.insurerOwedMinor, currency)} icon={ShieldCheck} href="/insurance?tab=claims&status=APPROVED" />}
            </div>
          )}

          {(w?.hospital || w?.surgery) && (
            <div className="grid gap-4 xl:grid-cols-3">
              {w.hospital && (
                <div className="grid grid-cols-2 gap-3 xl:col-span-1 xl:grid-cols-1">
                  <Stat label="In hospital" value={w.hospital.inpatients} icon={BedDouble} href="/hospital" hint={w.hospital.critical.length ? `${w.hospital.critical.length} critical` : undefined} tone={w.hospital.critical.length ? 'danger' : 'default'} />
                  <Stat label="Overdue treatments" value={w.hospital.overdueTreatments} icon={AlertOctagon} href="/hospital" tone={w.hospital.overdueTreatments ? 'danger' : 'default'} />
                </div>
              )}
              {w.surgery && (
                <Card className="xl:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Scissors className="h-4 w-4 text-muted-foreground" /> Surgery today</CardTitle>
                    <Link href="/surgery" className="text-xs text-primary hover:underline">Theatre list</Link>
                  </CardHeader>
                  {w.surgery.today.length ? (
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
                  ) : <EmptyState title="No surgery scheduled today" className="py-6" />}
                </Card>
              )}
            </div>
          )}

          {w?.finance && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Stat label="Billed today" value={fmtMoney(w.finance.billedTodayMinor, currency)} icon={Receipt} href="/billing?tab=all" />
              <Stat label="Received today" value={fmtMoney(w.finance.receivedTodayMinor, currency)} icon={Wallet} href="/billing/payments" tone="success" />
              <Stat label="Outstanding" value={fmtMoney(w.finance.outstandingMinor, currency)} icon={Receipt} href="/billing" hint={w.finance.overdueInvoices ? `${w.finance.overdueInvoices} overdue invoice${w.finance.overdueInvoices === 1 ? '' : 's'}` : 'None overdue'} tone={w.finance.overdueInvoices ? 'warning' : 'default'} />
              <Stat label="Unbilled charges" value={w.finance.unbilledCount} icon={ListChecks} href="/billing/charges" hint={`${fmtMoney(w.finance.unbilledMinor, currency)} before tax`} tone={w.finance.unbilledCount ? 'warning' : 'default'} />
            </div>
          )}

          {w?.inventory && (
            <div className="grid gap-4 xl:grid-cols-3">
              <Stat label="Stock value at cost" value={fmtMoney(w.inventory.valueMinor, currency)} icon={Boxes} href="/inventory" hint={`${w.inventory.lowStockCount} low · ${w.inventory.expiringCount} expiring within 60 days`} />
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
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Stat label="Active clients" value={w.registrations.activeClients.toLocaleString()} icon={Users} href="/clients" />
              <Stat label="Active patients" value={w.registrations.activePatients.toLocaleString()} icon={PawPrint} href="/patients" />
              <Stat label="New clients" value={w.registrations.newClients} hint={rangeLabel} icon={UserPlus} tone="success" />
              <Stat label="New patients" value={w.registrations.newPatients} hint={rangeLabel} icon={PawPrint} tone="success" />
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            {w?.registrations && (
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>Active patients by species</CardTitle>
                </CardHeader>
                <CardContent className="h-[260px]">
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
            )}

            {w?.criticalAlerts && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertOctagon className="h-4 w-4 text-destructive" /> Critical patient alerts
                  </CardTitle>
                </CardHeader>
                {w.criticalAlerts.length ? (
                  <ul className="divide-y">
                    {w.criticalAlerts.map((a) => (
                      <li key={a.id}>
                        <Link href={`/patients/${a.patient.id}`} className="block px-4 py-2.5 hover:bg-muted/50">
                          <p className="text-sm font-medium">{a.patient.name}</p>
                          <p className="text-xs text-destructive">{a.title}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No critical alerts" className="py-8" />
                )}
              </Card>
            )}
          </div>

          {w?.recentPatients && (
            <Card>
              <CardHeader>
                <CardTitle>Recently registered patients</CardTitle>
                <Link href="/patients?sort=-createdAt" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </CardHeader>
              {w.recentPatients.length ? (
                <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
                  {w.recentPatients.map((p) => (
                    <li key={p.id} className="border-b last:border-0 sm:[&:nth-last-child(-n+2)]:border-0">
                      <Link href={`/patients/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {p.name} <span className="font-normal text-muted-foreground">· {p.species}</span>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.patientNo} · {p.owner?.displayName ?? 'No owner'}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground" title={fmtDate(p.createdAt)}>
                          {fmtRelative(p.createdAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No patients registered yet" />
              )}
            </Card>
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
