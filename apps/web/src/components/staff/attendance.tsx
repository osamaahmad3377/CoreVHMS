'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { CalendarDays, Clock, Coffee, LogIn, LogOut, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime, dayLabel, hhmm, localDate, parseHhmm, shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { AttendanceDay, AttendanceMe, AttendanceRecord, AttendanceStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

/** 450 → "7h 30m", 45 → "45m". */
export function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

const STATUS: Record<AttendanceStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'secondary' | 'outline' }> = {
  IN: { label: 'In', variant: 'success' },
  ON_BREAK: { label: 'On a break', variant: 'info' },
  DONE: { label: 'Clocked out', variant: 'secondary' },
  NOT_IN_YET: { label: 'Not in yet', variant: 'outline' },
  ABSENT: { label: 'Absent', variant: 'destructive' },
  ON_LEAVE: { label: 'On leave', variant: 'info' },
  DAY_OFF: { label: 'Day off', variant: 'outline' },
  UPCOMING: { label: 'Rostered', variant: 'outline' },
  NOT_TRACKED: { label: 'Not recorded', variant: 'outline' },
  PRESENT: { label: 'Present', variant: 'success' },
};

/** Status badge plus late / left early chips. */
export function AttendanceBadges({ day }: { day: AttendanceDay }) {
  const s = STATUS[day.status];
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant={s.variant} className="normal-case tracking-normal">
        {day.status === 'ON_LEAVE' && day.leaveType ? `${enumLabel(day.leaveType)} leave` : s.label}
      </Badge>
      {day.lateMinutes > 0 && (
        <Badge variant="warning" className="normal-case tracking-normal">
          {day.records.length ? `Late ${fmtMinutes(day.lateMinutes)}` : `${fmtMinutes(day.lateMinutes)} late so far`}
        </Badge>
      )}
      {day.earlyMinutes > 0 && (
        <Badge variant="warning" className="normal-case tracking-normal">
          Left {fmtMinutes(day.earlyMinutes)} early
        </Badge>
      )}
    </span>
  );
}

/** "09:00–13:00, 14:00–18:00" or what the day is instead. */
export function rosterText(day: AttendanceDay) {
  if (day.slots.length) return day.slots.map((s) => `${hhmm(s.startMinute)}–${hhmm(s.endMinute)}`).join(', ');
  return 'Not rostered';
}

/** "08:58 – 17:04" ("08:58 – now" while on shift; "(+1)" when it ended the next day). */
export function shiftText(r: AttendanceRecord, tz: string) {
  const inn = branchTime(r.clockInAt, tz);
  if (!r.clockOutAt) return `${inn} – now`;
  const nextDay = localDate(r.clockOutAt, tz) !== localDate(r.clockInAt, tz);
  return `${inn} – ${branchTime(r.clockOutAt, tz)}${nextDay ? ' (+1)' : ''}`;
}

export function useAttendanceMe(enabled = true) {
  return useQuery({ queryKey: ['attendance', 'me'], queryFn: () => api.get<AttendanceMe>('/attendance/me'), enabled, refetchInterval: 60_000 });
}

/** Clock in / break / clock out for the signed-in person, shown in the top bar. */
export function ClockButton() {
  const { session, can } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const allowed = can('attendance.clock') && !!session.branch;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const me = useAttendanceMe(allowed);
  const act = useMutation({
    mutationFn: (path: 'clock-in' | 'clock-out' | 'break/start' | 'break/end') => api.post<AttendanceRecord>(`/attendance/${path}`, {}).then((r) => ({ r, path })),
    onSuccess: ({ r, path }) => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      if (path === 'clock-in') toast.success(`Clocked in at ${branchTime(r.clockInAt, tz)}`);
      else if (path === 'clock-out') toast.success(`Clocked out at ${branchTime(r.clockOutAt!, tz)} — ${fmtMinutes(Math.max(0, Math.round((Date.parse(r.clockOutAt!) - Date.parse(r.clockInAt)) / 60_000) - r.breakMinutes))} worked`);
      else toast.success(path === 'break/start' ? 'Break started' : 'Welcome back — break ended');
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ['attendance', 'me'] });
    },
  });
  if (!allowed || !me.data) return null;
  const open = me.data.open;

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" loading={act.isPending} onClick={() => act.mutate('clock-in')} title="Start your shift">
        <LogIn /> <span className="hidden sm:inline">Clock in</span>
      </Button>
    );
  }
  const onBreak = !!open.breakStartedAt;
  const clockOut = async () => {
    const r = await confirm({
      title: 'Clock out now?',
      description: `You clocked in at ${branchTime(open.clockInAt, tz)} and have worked ${fmtMinutes(open.workedMinutes)}${onBreak ? '. Your break ends too.' : '.'}`,
      confirmLabel: 'Clock out',
    });
    if (r.confirmed) act.mutate('clock-out');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" aria-label="Your shift" title="Your shift: break or clock out">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', onBreak ? 'bg-info' : 'animate-pulse bg-success')} />
          <span className="hidden sm:inline">{onBreak ? 'On a break' : 'On shift'}</span>
          <span className="tabular text-muted-foreground">{fmtMinutes(open.workedMinutes)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block font-medium">Clocked in at {branchTime(open.clockInAt, tz)}</span>
          <span className="block text-xs text-muted-foreground">
            {open.branchName}
            {open.breakMinutes > 0 && ` · ${fmtMinutes(open.breakMinutes)} break so far`}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onBreak ? (
          <DropdownMenuItem onSelect={() => act.mutate('break/end')}>
            <Play /> End break
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => act.mutate('break/start')}>
            <Coffee /> Start a break
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={clockOut}>
          <LogOut /> Clock out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/staff/attendance?view=me">
            <CalendarDays /> My attendance
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Manager: add or correct a shift ──

type ShiftForm = { membershipId: string; date: string; inTime: string; outTime: string; breakMinutes: string; note: string; reason: string };

/** Add a shift someone forgot to clock, or correct one. Always with a reason (kept in the activity log). */
export function ShiftDialog({
  open,
  onOpenChange,
  record,
  staff,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record?: AttendanceRecord | null;
  staff: { membershipId: string; name: string }[];
  defaults?: { membershipId?: string; date?: string };
}) {
  const { session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const qc = useQueryClient();
  const blank = (): ShiftForm =>
    record
      ? {
          membershipId: record.membershipId,
          date: localDate(record.clockInAt, tz),
          inTime: branchTime(record.clockInAt, tz),
          outTime: record.clockOutAt ? branchTime(record.clockOutAt, tz) : '',
          breakMinutes: String(record.breakMinutes),
          note: record.note ?? '',
          reason: '',
        }
      : { membershipId: defaults?.membershipId ?? '', date: defaults?.date ?? todayIn(tz), inTime: '09:00', outTime: '17:00', breakMinutes: '0', note: '', reason: '' };
  const [f, setF] = useState<ShiftForm>(blank);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(blank());
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.id]);

  const set = (k: keyof ShiftForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const inMin = f.inTime ? parseHhmm(f.inTime) : NaN;
  const outMin = f.outTime ? parseHhmm(f.outTime) : null;
  const overnight = outMin != null && outMin <= inMin;
  const brk = Number(f.breakMinutes || 0);
  const breakOk = Number.isInteger(brk) && brk >= 0 && brk <= 720;
  const ready = !!f.membershipId && !!f.date && !Number.isNaN(inMin) && breakOk && f.reason.trim().length > 0;

  const save = useMutation({
    mutationFn: () => {
      const clockInAt = zonedInstant(f.date, inMin, tz).toISOString();
      const clockOutAt = outMin == null ? null : zonedInstant(overnight ? shiftDate(f.date, 1) : f.date, outMin, tz).toISOString();
      const body = { clockInAt, clockOutAt, breakMinutes: brk, note: f.note, reason: f.reason };
      return record ? api.patch(`/attendance/${record.id}`, body) : api.post('/attendance', { ...body, membershipId: f.membershipId });
    },
    onSuccess: () => {
      toast.success(record ? 'Shift corrected' : 'Shift added');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record ? 'Correct a shift' : 'Add a shift'}</DialogTitle>
          <DialogDescription>
            {record ? 'Change the clock times. The old times and your reason are kept in the activity log.' : 'For someone who forgot to clock in, or from a paper timesheet.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          {!record && (
            <Field label="Staff member" htmlFor="sh-m" required>
              <NativeSelect id="sh-m" value={f.membershipId} onChange={set('membershipId')}>
                <option value="">Select…</option>
                {staff.map((s) => (
                  <option key={s.membershipId} value={s.membershipId}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Day" htmlFor="sh-d" required>
            <Input id="sh-d" type="date" max={todayIn(tz)} value={f.date} onChange={set('date')} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Clock in" htmlFor="sh-in" required>
              <Input id="sh-in" type="time" value={f.inTime} onChange={set('inTime')} />
            </Field>
            <Field label="Clock out" htmlFor="sh-out" hint={overnight ? 'Next day' : f.outTime ? undefined : 'Still on shift'}>
              <Input id="sh-out" type="time" value={f.outTime} onChange={set('outTime')} />
            </Field>
            <Field label="Break (min)" htmlFor="sh-b" error={breakOk ? undefined : '0 to 720'}>
              <Input id="sh-b" type="number" min={0} max={720} step={5} value={f.breakMinutes} onChange={set('breakMinutes')} />
            </Field>
          </div>
          <Field label="Note" htmlFor="sh-n">
            <Input id="sh-n" value={f.note} maxLength={300} onChange={set('note')} />
          </Field>
          <Field label="Reason for the change" htmlFor="sh-r" required hint="For example “Forgot to clock in” or “Paper timesheet”.">
            <Textarea id="sh-r" rows={2} value={f.reason} maxLength={300} onChange={set('reason')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            {record ? 'Save correction' : 'Add shift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useRemoveShift() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const m = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.del(`/attendance/${id}?reason=${encodeURIComponent(reason)}`),
    onSuccess: () => {
      toast.success('Shift removed');
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return async (r: AttendanceRecord) => {
    const c = await confirm({ title: 'Remove this shift?', description: 'Only for a shift recorded by mistake. It stays in the activity log.', destructive: true, confirmLabel: 'Remove', requireReason: true, reasonLabel: 'Reason' });
    if (c.confirmed && c.reason) m.mutate({ id: r.id, reason: c.reason });
  };
}

/** One person's days, newest first: roster, clock times, worked hours and status. */
export function DayList({
  days,
  tz,
  today,
  onEdit,
  onRemove,
  onAdd,
}: {
  days: AttendanceDay[];
  tz: string;
  today: string;
  onEdit?: (r: AttendanceRecord) => void;
  onRemove?: (r: AttendanceRecord) => void;
  onAdd?: (date: string) => void;
}) {
  const shown = [...days].filter((d) => d.date <= today && (!['DAY_OFF', 'NOT_TRACKED'].includes(d.status) || d.records.length)).reverse();
  if (!shown.length) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing to show for these days.</p>;
  return (
    <ul className="divide-y">
      {shown.map((d) => (
        <li key={d.date} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)_auto] sm:items-start sm:gap-3">
          <div>
            <p className="text-sm font-medium">{dayLabel(d.date, 'EEE d MMM')}</p>
            <p className="text-xs text-muted-foreground tabular">{rosterText(d)}</p>
          </div>
          <div className="grid gap-1">
            <AttendanceBadges day={d} />
            {d.records.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="tabular">{shiftText(r, tz)}</span>
                {r.breakMinutes > 0 && <span className="text-xs text-muted-foreground">· {fmtMinutes(r.breakMinutes)} break</span>}
                {r.source === 'MANAGER' || r.editReason ? (
                  <span className="text-xs text-muted-foreground" title={r.editReason ?? undefined}>
                    · {r.source === 'REGISTER' ? 'ticked in the register' : `${r.source === 'MANAGER' ? 'added' : 'corrected'} by a manager${r.editReason ? `: ${r.editReason}` : ''}`}
                  </span>
                ) : null}
                {r.note && <span className="text-xs text-muted-foreground">· {r.note}</span>}
                {onEdit && (
                  <Button size="icon-sm" variant="ghost" aria-label="Correct this shift" onClick={() => onEdit(r)}>
                    <Pencil />
                  </Button>
                )}
                {onRemove && (
                  <Button size="icon-sm" variant="ghost" aria-label="Remove this shift" onClick={() => onRemove(r)}>
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            {d.workedMinutes > 0 && (
              <span className="flex items-center gap-1 text-sm tabular">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" /> {fmtMinutes(d.workedMinutes)}
              </span>
            )}
            {onAdd && (
              <Button size="icon-sm" variant="ghost" aria-label={`Add a shift on ${d.date}`} onClick={() => onAdd(d.date)}>
                <Plus />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

