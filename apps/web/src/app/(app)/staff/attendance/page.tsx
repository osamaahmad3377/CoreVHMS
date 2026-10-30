'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, Download, Pencil, Plus, Settings2, Trash2, UserCheck } from 'lucide-react';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { AttendanceRegister } from '@/components/staff/attendance-register';
import { AttendanceBadges, DayList, ShiftDialog, fmtMinutes, rosterText, shiftText, useRemoveShift } from '@/components/staff/attendance';
import { StaffTabs } from '@/components/staff/staff-tabs';
import { Stat } from '@/components/stat';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import { dayLabel, shiftDate, todayIn } from '@/lib/time';
import type { AttendanceRange, AttendanceRecord } from '@/lib/types';

type View = 'register' | 'day' | 'summary' | 'person' | 'me';

const monthStart = (date: string) => `${date.slice(0, 8)}01`;
const monthEnd = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** From / to pickers with This month / Last month shortcuts. */
function RangePicker({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const lastMonth = shiftDate(monthStart(today), -1);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" aria-label="From" className="h-8 w-[150px]" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
      <span className="text-xs text-muted-foreground">to</span>
      <Input type="date" aria-label="To" className="h-8 w-[150px]" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
      <Button size="sm" variant="ghost" onClick={() => onChange(monthStart(today), today)}>
        This month
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onChange(monthStart(lastMonth), monthEnd(lastMonth))}>
        Last month
      </Button>
    </div>
  );
}

function GraceDialog({ open, onOpenChange, current }: { open: boolean; onOpenChange: (o: boolean) => void; current: number }) {
  const qc = useQueryClient();
  const [v, setV] = useState(String(current));
  const [error, setError] = useState<string | null>(null);
  const n = Number(v);
  const ok = v !== '' && Number.isInteger(n) && n >= 0 && n <= 120;
  const save = useMutation({
    mutationFn: () => api.put('/attendance/settings', { graceMinutes: n }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>When is someone late?</DialogTitle>
          <DialogDescription>Clocking in this many minutes after the rostered start counts as late (and clocking out this many minutes before the end, as leaving early).</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Minutes allowed" htmlFor="grace" error={ok ? undefined : 'Enter 0 to 120'}>
          <Input id="grace" type="number" min={0} max={120} className="w-32" value={v} onChange={(e) => setV(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function downloadCsv(data: AttendanceRange) {
  const head = ['Staff', 'Job title', 'Days rostered', 'Days present', 'Days late', 'Days left early', 'Days absent', 'Days on leave', 'Hours worked', 'Hours rostered'];
  const hours = (m: number) => (m / 60).toFixed(2);
  const rows = data.members.map((m) => [
    m.name,
    m.jobTitle ?? '',
    m.totals.rosteredDays,
    m.totals.presentDays,
    m.totals.lateDays,
    m.totals.earlyDays,
    m.totals.absentDays,
    m.totals.leaveDays,
    hours(m.totals.workedMinutes),
    hours(m.totals.rosteredMinutes),
  ]);
  const cell = (v: unknown) => {
    const s = String(v);
    // Quote, and stop spreadsheet formulas in names (=, +, -, @).
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const csv = [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${data.branch.name.replace(/[^\w-]+/g, '-')}-${data.from}-to-${data.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function AttendanceView() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const branchId = session.branch?.id ?? '';
  const manage = can('attendance.manage');
  const url = useUrlState();
  const today = todayIn(tz);
  const view = (manage ? url.get('view', 'register') : 'me') as View;
  const month = url.get('month', today.slice(0, 7));
  const date = url.get('date', today);
  const from = url.get('from', monthStart(today));
  const to = url.get('to', today);
  const member = url.get('member');
  const [shift, setShift] = useState<{ record: AttendanceRecord | null; membershipId?: string; date?: string; key: number } | null>(null);
  const [grace, setGrace] = useState(false);
  const remove = useRemoveShift();

  const range = view === 'day' ? { from: date, to: date } : view === 'register' ? { from: `${month}-01`, to: monthEnd(`${month}-01`) } : { from, to };
  const q = useQuery({
    queryKey: ['attendance', view, branchId, range.from, range.to, view === 'person' ? member : null],
    queryFn: () =>
      view === 'me'
        ? api.get<AttendanceRange>(`/attendance/me/history${qs(range)}`)
        : api.get<AttendanceRange>(`/attendance${qs({ ...range, branchId, membershipId: view === 'person' ? member : undefined })}`),
    enabled: !!branchId,
    refetchInterval: view === 'day' && date === today ? 60_000 : false,
  });
  const staffList = useQuery({
    queryKey: ['attendance', 'staff', branchId, today],
    queryFn: () => api.get<AttendanceRange>(`/attendance${qs({ from: today, to: today, branchId })}`),
    enabled: manage && !!branchId && view !== 'day' && view !== 'register',
  });
  const staff = (view === 'day' || view === 'register' ? q.data : staffList.data)?.members ?? [];
  const data = q.data;

  const tabs: { v: View; label: string }[] = manage
    ? [
        { v: 'register', label: 'Register' },
        { v: 'day', label: 'Today & by day' },
        { v: 'summary', label: 'Summary' },
        { v: 'me', label: 'My attendance' },
      ]
    : [];

  return (
    <>
      <PageHeader
        help="attendance"
        title="Attendance"
        description={
          manage
            ? `Who is in, late or absent at ${session.branch?.name ?? ''}, compared with the roster.`
            : `Your clock-ins and hours at ${session.branch?.name ?? ''}. Clock in and out with the button at the top of the screen.`
        }
        actions={
          manage && (
            <>
              <Button size="sm" variant="outline" onClick={() => setGrace(true)} title="When clocking in counts as late">
                <Settings2 /> Late after {data?.graceMinutes ?? '…'} min
              </Button>
              <Button size="sm" onClick={() => setShift({ record: null, date: view === 'day' ? date : today, key: Date.now() })}>
                <Plus /> Add a shift
              </Button>
            </>
          )
        }
      />
      <StaffTabs />

      {tabs.length > 0 && (
        <div className="mb-4">
          <div className={tabListClass} role="tablist" aria-label="Attendance view">
            {tabs.map((t) => (
              <button key={t.v} role="tab" aria-selected={view === t.v || (t.v === 'summary' && view === 'person')} className={tabTriggerClass()} onClick={() => url.set({ view: t.v, member: null })}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        {view === 'register' ? (
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => url.set({ month: shiftDate(`${month}-01`, -1).slice(0, 7) })}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="sm" onClick={() => url.set({ month: null })}>
                This month
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => url.set({ month: shiftDate(monthEnd(`${month}-01`), 1).slice(0, 7) })}>
                <ChevronRight />
              </Button>
            </div>
            <span className="text-sm font-medium sm:ml-2">{dayLabel(`${month}-01`, 'MMMM yyyy')}</span>
          </>
        ) : view === 'day' ? (
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => url.set({ date: shiftDate(date, -1) })}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="sm" onClick={() => url.set({ date: null })}>
                Today
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next day" disabled={date >= today} onClick={() => url.set({ date: shiftDate(date, 1) })}>
                <ChevronRight />
              </Button>
            </div>
            <Input type="date" aria-label="Day" className="h-8 w-[150px]" max={today} value={date} onChange={(e) => e.target.value && url.set({ date: e.target.value })} />
            <span className="text-sm font-medium sm:ml-2">{dayLabel(date, 'EEEE d MMMM')}</span>
          </>
        ) : (
          <>
            <RangePicker from={from} to={to} today={today} onChange={(f, t) => url.set({ from: f, to: t })} />
            {view === 'person' && (
              <NativeSelect aria-label="Staff member" className="h-8 w-[200px] text-sm sm:ml-auto" value={member} onChange={(e) => url.set({ member: e.target.value })}>
                {staff.map((s) => (
                  <option key={s.membershipId} value={s.membershipId}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            {view === 'summary' && data && data.members.length > 0 && (
              <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => downloadCsv(data)}>
                <Download /> Download for payroll (CSV)
              </Button>
            )}
          </>
        )}
      </Card>

      {q.isLoading ? (
        <LoadingRows rows={5} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data || !data.members.length ? (
        <EmptyState icon={UserCheck} title="No staff at this branch" description="Staff who work at this branch, and anyone who clocked in here, are listed." />
      ) : view === 'register' ? (
        <Card className="min-w-0 overflow-hidden">
          <AttendanceRegister data={data} tz={tz} onNeedTimes={(m, d) => setShift({ record: null, membershipId: m, date: d, key: Date.now() })} />
        </Card>
      ) : view === 'day' ? (
        <DayTable data={data} tz={tz} onEdit={(r) => setShift({ record: r, key: Date.now() })} onRemove={remove} onAdd={(m) => setShift({ record: null, membershipId: m, date, key: Date.now() })} />
      ) : view === 'summary' ? (
        <SummaryTable data={data} onOpen={(m) => url.set({ view: 'person', member: m })} />
      ) : (
        <PersonView
          data={data}
          tz={tz}
          manage={view === 'person'}
          onEdit={(r) => setShift({ record: r, key: Date.now() })}
          onRemove={remove}
          onAdd={(d) => setShift({ record: null, membershipId: data.members[0]?.membershipId, date: d, key: Date.now() })}
        />
      )}

      {manage && shift && (
        <ShiftDialog key={shift.key} open onOpenChange={(o) => !o && setShift(null)} record={shift.record} staff={staff} defaults={{ membershipId: shift.membershipId, date: shift.date }} />
      )}
      {manage && data && grace && <GraceDialog open onOpenChange={setGrace} current={data.graceMinutes} />}
    </>
  );
}

function DayTable({
  data,
  tz,
  onEdit,
  onRemove,
  onAdd,
}: {
  data: AttendanceRange;
  tz: string;
  onEdit: (r: AttendanceRecord) => void;
  onRemove: (r: AttendanceRecord) => void;
  onAdd: (membershipId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const all = data.members.map((m) => ({ m, d: m.days[0] }));
  // Staff with no roster and no clock-in that day are tucked away (many clinics have part-time or occasional staff).
  const quiet = all.filter(({ d }) => !d.slots.length && !d.records.length && !d.onLeave);
  const rows = showAll ? all : all.filter((r) => !quiet.includes(r));
  const count = (f: (d: (typeof all)[number]['d']) => boolean) => all.filter((r) => f(r.d)).length;
  const isToday = data.from === data.today;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={isToday ? 'In now' : 'Worked'} value={isToday ? count((d) => d.status === 'IN' || d.status === 'ON_BREAK') : count((d) => d.records.length > 0)} tone="success" />
        <Stat label="Late" value={count((d) => d.lateMinutes > 0)} tone="warning" />
        <Stat label={isToday ? 'Not in / absent' : 'Absent'} value={count((d) => d.status === 'ABSENT' || d.status === 'NOT_IN_YET')} tone="danger" />
        <Stat label="On leave" value={count((d) => d.status === 'ON_LEAVE')} />
      </div>
      <Card className="min-w-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Staff</th>
                <th className="px-3 py-2 text-left font-semibold">Rostered</th>
                <th className="px-3 py-2 text-left font-semibold">Clocked</th>
                <th className="px-3 py-2 text-left font-semibold">Worked</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, d }) => (
                <tr key={m.membershipId} className="border-t align-top">
                  <td className="min-w-[150px] px-3 py-2">
                    <p className="font-medium">{m.name}</p>
                    {m.jobTitle && <p className="text-xs text-muted-foreground">{m.jobTitle}</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular text-muted-foreground">{rosterText(d)}</td>
                  <td className="px-3 py-2">
                    {d.records.length ? (
                      <div className="grid gap-1">
                        {d.records.map((r) => (
                          <div key={r.id} className="flex flex-wrap items-center gap-1">
                            <span className="whitespace-nowrap tabular">{shiftText(r, tz)}</span>
                            {r.breakMinutes > 0 && <span className="text-xs text-muted-foreground">({fmtMinutes(r.breakMinutes)} break)</span>}
                            {(r.source === 'MANAGER' || r.editReason) && (
                              <span className="text-xs text-muted-foreground" title={r.editReason ?? undefined}>
                                · {r.source === 'REGISTER' ? 'register' : r.source === 'MANAGER' ? 'added' : 'corrected'}
                              </span>
                            )}
                            <Button size="icon-sm" variant="ghost" aria-label={`Correct ${m.name}’s shift`} onClick={() => onEdit(r)}>
                              <Pencil />
                            </Button>
                            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}’s shift`} onClick={() => onRemove(r)}>
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{d.workedMinutes ? fmtMinutes(d.workedMinutes) : '—'}</td>
                  <td className="px-3 py-2">
                    <AttendanceBadges day={d} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button size="icon-sm" variant="ghost" aria-label={`Add a shift for ${m.name}`} title="Add a shift" onClick={() => onAdd(m.membershipId)}>
                      <Plus />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <QuietToggle count={quiet.length} showAll={showAll} onToggle={() => setShowAll(!showAll)} what="not rostered and didn’t clock in" />
      </Card>
    </>
  );
}

function QuietToggle({ count, showAll, onToggle, what }: { count: number; showAll: boolean; onToggle: () => void; what: string }) {
  if (!count) return null;
  return (
    <div className="border-t px-3 py-2">
      <Button size="sm" variant="ghost" onClick={onToggle}>
        {showAll ? `Hide ${count} ${count === 1 ? 'person' : 'people'} ${what}` : `Show ${count} more (${what})`}
      </Button>
    </div>
  );
}

function SummaryTable({ data, onOpen }: { data: AttendanceRange; onOpen: (membershipId: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const quiet = data.members.filter((m) => !m.totals.rosteredDays && !m.totals.presentDays && !m.totals.leaveDays);
  const members = showAll ? data.members : data.members.filter((m) => !quiet.includes(m));
  const th = 'whitespace-nowrap px-3 py-2 text-right font-semibold';
  const td = 'px-3 py-2 text-right tabular';
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Staff</th>
              <th className={th}>Rostered days</th>
              <th className={th}>Present</th>
              <th className={th}>Late</th>
              <th className={th}>Left early</th>
              <th className={th}>Absent</th>
              <th className={th}>On leave</th>
              <th className={th}>Hours worked</th>
              <th className={th}>Hours rostered</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId} className="border-t">
                <td className="min-w-[150px] px-3 py-2">
                  <button className="text-left font-medium hover:underline" onClick={() => onOpen(m.membershipId)}>
                    {m.name}
                  </button>
                  {m.jobTitle && <p className="text-xs text-muted-foreground">{m.jobTitle}</p>}
                </td>
                <td className={td}>{m.totals.rosteredDays}</td>
                <td className={td}>{m.totals.presentDays}</td>
                <td className={`${td} ${m.totals.lateDays ? 'text-warning' : ''}`}>{m.totals.lateDays}</td>
                <td className={`${td} ${m.totals.earlyDays ? 'text-warning' : ''}`}>{m.totals.earlyDays}</td>
                <td className={`${td} ${m.totals.absentDays ? 'font-medium text-destructive' : ''}`}>{m.totals.absentDays}</td>
                <td className={td}>{m.totals.leaveDays}</td>
                <td className={td}>{fmtMinutes(m.totals.workedMinutes)}</td>
                <td className={`${td} text-muted-foreground`}>{fmtMinutes(m.totals.rosteredMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <QuietToggle count={quiet.length} showAll={showAll} onToggle={() => setShowAll(!showAll)} what="not rostered and never clocked in" />
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Counts up to today{data.trackedFrom > data.from ? `, from ${dayLabel(data.trackedFrom, 'd MMM yyyy')} when attendance was first recorded` : ''}. Click a name to see that person’s days.
      </p>
    </Card>
  );
}

function PersonView({
  data,
  tz,
  manage,
  onEdit,
  onRemove,
  onAdd,
}: {
  data: AttendanceRange;
  tz: string;
  manage: boolean;
  onEdit: (r: AttendanceRecord) => void;
  onRemove: (r: AttendanceRecord) => void;
  onAdd: (date: string) => void;
}) {
  const m = data.members[0];
  if (!m) return <EmptyState icon={Clock} title="No attendance for these days" />;
  const t = m.totals;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hours worked" value={fmtMinutes(t.workedMinutes)} hint={`of ${fmtMinutes(t.rosteredMinutes)} rostered`} />
        <Stat label="Days present" value={`${t.presentDays} of ${t.rosteredDays}`} tone="success" />
        <Stat label="Late" value={t.lateDays} hint={t.earlyDays ? `left early ${t.earlyDays}` : undefined} tone="warning" />
        <Stat label="Absent" value={t.absentDays} hint={t.leaveDays ? `${t.leaveDays} on leave` : undefined} tone="danger" />
      </div>
      <Card className="min-w-0 overflow-hidden">
        <div className="border-b px-3 py-2">
          <p className="font-medium">{m.name}</p>
          {m.jobTitle && <p className="text-xs text-muted-foreground">{m.jobTitle}</p>}
        </div>
        <DayList days={m.days} tz={tz} today={data.today} onEdit={manage ? onEdit : undefined} onRemove={manage ? onRemove : undefined} onAdd={manage ? onAdd : undefined} />
      </Card>
    </>
  );
}

export default function AttendancePage() {
  return (
    <RequirePermission anyOf={['attendance.clock', 'attendance.manage']}>
      <Suspense>
        <AttendanceView />
      </Suspense>
    </RequirePermission>
  );
}
