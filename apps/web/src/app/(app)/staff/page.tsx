'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAVE_TYPES, enumLabel } from '@vcms/shared';
import { CalendarOff, Clock, Edit, Plus, Trash2, UserCog, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { MemberDialog, TemporaryPasswordDialog, type TemporaryPassword } from '@/components/staff/member-dialog';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { hhmm, parseHhmm, todayIn, zonedInstant, shiftDate } from '@/lib/time';
import type { RosterEntry } from '@/lib/types';

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Slot = { dayOfWeek: number; start: string; end: string };

function HoursDialog({ entry, open, onOpenChange }: { entry: RosterEntry | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const branchId = session.branch!.id;
  const initial: Slot[] = (entry?.workingHours ?? []).filter((h) => h.branchId === branchId).map((h) => ({ dayOfWeek: h.dayOfWeek, start: hhmm(h.startMinute), end: hhmm(h.endMinute) }));
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/schedules/working-hours/${entry!.membershipId}`, {
        branchId,
        slots: slots.map((s) => ({ dayOfWeek: s.dayOfWeek, startMinute: parseHhmm(s.start), endMinute: parseHhmm(s.end) })),
      }),
    onSuccess: () => {
      toast.success('Working hours saved');
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  const copyMonToWeekdays = () => {
    const mon = slots.filter((s) => s.dayOfWeek === 1);
    setSlots([...slots.filter((s) => ![2, 3, 4, 5].includes(s.dayOfWeek)), ...[2, 3, 4, 5].flatMap((d) => mon.map((m) => ({ ...m, dayOfWeek: d })))]);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Working hours — {entry?.name}</DialogTitle>
          <DialogDescription>Weekly pattern at {session.branch?.name}. Add two shifts on a day for a split shift with a break.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-2">
          {DAYS.map((d) => {
            const daySlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.dayOfWeek === d);
            return (
              <div key={d} className="grid grid-cols-[48px_1fr_auto] items-start gap-2">
                <span className="pt-2 text-sm font-medium">{DAY_NAMES[d]}</span>
                <div className="grid gap-1.5">
                  {daySlots.length === 0 && <span className="pt-2 text-sm text-muted-foreground">Off</span>}
                  {daySlots.map(({ s, i }) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input type="time" step={900} className="h-8 w-[120px]" aria-label={`${DAY_NAMES[d]} start`} value={s.start} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input type="time" step={900} className="h-8 w-[120px]" aria-label={`${DAY_NAMES[d]} end`} value={s.end} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                      <Button size="icon-sm" variant="ghost" aria-label="Remove shift" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSlots([...slots, { dayOfWeek: d, start: daySlots.length ? '14:00' : '09:00', end: daySlots.length ? '18:00' : '17:00' }])}>
                  <Plus /> Shift
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={copyMonToWeekdays}>
            Copy Monday to Tue–Fri
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save hours</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({ roster, open, onOpenChange }: { roster: RosterEntry[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const [membershipId, setMember] = useState('');
  const [type, setType] = useState('ANNUAL');
  const [from, setFrom] = useState(todayIn(tz));
  const [to, setTo] = useState(todayIn(tz));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ affectedAppointments: number }>('/schedules/leave', {
        membershipId,
        type,
        startsAt: zonedInstant(from, 0, tz).toISOString(),
        endsAt: zonedInstant(shiftDate(to, 1), 0, tz).toISOString(),
        reason,
      }),
    onSuccess: (r) => {
      if (r.affectedAppointments) toast.warning(`Leave saved. ${r.affectedAppointments} existing appointment(s) fall in this period — reschedule them from the calendar.`);
      else toast.success('Leave saved');
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['leave'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record leave</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <Field label="Staff member" htmlFor="lv-m" required>
            <NativeSelect id="lv-m" value={membershipId} onChange={(e) => setMember(e.target.value)}>
              <option value="">Select…</option>
              {roster.map((r) => <option key={r.membershipId} value={r.membershipId}>{r.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Type" htmlFor="lv-t">
            <NativeSelect id="lv-t" value={type} onChange={(e) => setType(e.target.value)}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" htmlFor="lv-f"><Input id="lv-f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Last day" htmlFor="lv-to"><Input id="lv-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="Reason" htmlFor="lv-r"><Input id="lv-r" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!membershipId || to < from} loading={m.isPending} onClick={() => { setError(null); m.mutate(); }}>Save leave</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Rosters() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const confirm = useConfirm();
  const from = zonedInstant(todayIn(tz), 0, tz).toISOString();
  const to = zonedInstant(shiftDate(todayIn(tz), 60), 0, tz).toISOString();
  const q = useQuery({ queryKey: ['roster', session.branch?.id, from, to], queryFn: () => api.get<RosterEntry[]>(`/schedules/roster${qs({ branchId: session.branch?.id, from, to })}`) });
  const [edit, setEdit] = useState<{ entry: RosterEntry | null; key: number }>({ entry: null, key: 0 });
  const [leave, setLeave] = useState(false);
  const [adding, setAdding] = useState(0);
  const [temp, setTemp] = useState<TemporaryPassword | null>(null);
  const removeLeave = useMutation({ mutationFn: (id: string) => api.del(`/schedules/leave/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['roster'] }) });

  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const roster = q.data!;
  const upcomingLeave = roster.flatMap((r) => r.leave.map((l) => ({ ...l, name: r.name })));

  return (
    <>
      <PageHeader
        help="setup"
        title="Staff"
        description={`Working hours and leave at ${session.branch?.name}. Appointments can only be booked when the person is working.`}
        actions={
          <>
            {can('staff.manage') && <Button size="sm" variant="outline" onClick={() => setLeave(true)}><CalendarOff /> Record leave</Button>}
            {can('users.manage') && <Button size="sm" onClick={() => setAdding(Date.now())}><UserPlus /> Add staff</Button>}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Weekly roster</CardTitle>
          </CardHeader>
          {roster.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Staff</th>
                    {DAYS.map((d) => <th key={d} className="whitespace-nowrap px-2 py-2 text-left font-semibold">{DAY_NAMES[d]}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.membershipId} className="border-t">
                      <td className="min-w-[160px] px-3 py-2 align-top">
                        <p className="font-medium">{r.name}</p>
                        {(r.jobTitle || r.isClinician) && (
                          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            {r.jobTitle && <span>{r.jobTitle}</span>}
                            {r.isClinician && <Badge variant="info" className="normal-case tracking-normal">Clinician</Badge>}
                          </p>
                        )}
                      </td>
                      {DAYS.map((d) => {
                        const hrs = r.workingHours.filter((h) => h.dayOfWeek === d && h.branchId === session.branch?.id);
                        return (
                          <td key={d} className="px-2 py-2 align-top text-xs tabular">
                            {hrs.length ? (
                              <div className="grid justify-start gap-1">
                                {hrs.map((h) => (
                                  <span key={h.id} className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5">{hhmm(h.startMinute)}–{hhmm(h.endMinute)}</span>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">
                        {can('staff.manage') && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Edit hours for ${r.name}`} onClick={() => setEdit({ entry: r, key: Date.now() })}>
                            <Edit />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={UserCog} title="No staff at this branch" />
          )}
        </Card>
        <Card className="h-fit min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CalendarOff className="h-4 w-4 text-muted-foreground" /> Upcoming leave</CardTitle>
          </CardHeader>
          {upcomingLeave.length ? (
            <ul className="divide-y">
              {upcomingLeave.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="break-words text-xs text-muted-foreground">{enumLabel(l.type)} · {fmtDate(l.startsAt)} – {fmtDate(new Date(new Date(l.endsAt).getTime() - 1))}{l.reason && ` · ${l.reason}`}</p>
                  </div>
                  {can('staff.manage') && (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove leave" onClick={async () => { const r = await confirm({ title: 'Remove this leave?', destructive: true, confirmLabel: 'Remove' }); if (r.confirmed) removeLeave.mutate(l.id); }}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No leave in the next 60 days" className="py-6" />
          )}
        </Card>
      </div>
      {edit.entry && <HoursDialog key={edit.key} entry={edit.entry} open={!!edit.entry} onOpenChange={(o) => !o && setEdit({ entry: null, key: 0 })} />}
      <LeaveDialog roster={roster} open={leave} onOpenChange={setLeave} />
      {/* Same dialog as Settings → Staff accounts. */}
      {adding > 0 && <MemberDialog key={adding} member={null} open onOpenChange={(o) => { if (!o) { setAdding(0); qc.invalidateQueries({ queryKey: ['roster'] }); } }} onTemporaryPassword={setTemp} />}
      <TemporaryPasswordDialog result={temp} onClose={() => setTemp(null)} />
    </>
  );
}

export default function StaffPage() {
  return (
    <RequirePermission anyOf={['staff.read', 'users.read']}>
      <Rosters />
    </RequirePermission>
  );
}
