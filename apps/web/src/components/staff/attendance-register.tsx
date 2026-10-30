'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { fmtMinutes, rosterText, shiftText } from './attendance';
import { api, ApiError } from '@/lib/api';
import { dayLabel } from '@/lib/time';
import type { AttendanceDay, AttendanceMember, AttendanceRange } from '@/lib/types';
import { cn } from '@/lib/utils';

type Vars = { membershipId: string; date: string; present: boolean; reason?: string };

/** What a cell means, for its colour and its tooltip. */
function cellInfo(d: AttendanceDay, tz: string, today: string) {
  const roster = d.slots.length ? `Rostered ${rosterText(d)}` : 'Not rostered';
  const times = d.records.map((r) => shiftText(r, tz)).join(', ');
  if (d.records.length) {
    const extra = [d.lateMinutes > 0 && `late ${fmtMinutes(d.lateMinutes)}`, d.earlyMinutes > 0 && `left ${fmtMinutes(d.earlyMinutes)} early`].filter(Boolean).join(', ');
    return { tone: d.lateMinutes > 0 || d.earlyMinutes > 0 ? 'late' : 'present', title: `Present ${times}${extra ? ` (${extra})` : ''}` };
  }
  if (d.date > today) return { tone: 'future', title: roster };
  if (d.onLeave) return { tone: 'leave', title: 'On leave' };
  if (d.status === 'ABSENT') return { tone: 'absent', title: `Absent — ${roster}` };
  if (d.status === 'NOT_IN_YET') return { tone: 'due', title: `Not in yet — ${roster}` };
  return { tone: d.slots.length ? 'blank' : 'off', title: roster };
}

const TONES: Record<string, string> = {
  present: 'bg-success/10',
  late: 'bg-warning/15',
  absent: 'bg-destructive/10',
  leave: 'bg-info/10',
  off: 'bg-muted/60',
  due: '',
  blank: '',
  future: 'opacity-40',
};

/**
 * The attendance register: staff down the side, days across, a tick for each day present. Ticking records the
 * person's rostered hours; unticking removes the day's shifts. Days they clocked themselves show ticked too.
 */
export function AttendanceRegister({ data, tz, onNeedTimes }: { data: AttendanceRange; tz: string; onNeedTimes: (membershipId: string, date: string) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [pending, setPending] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const days = data.members[0]?.days.map((d) => d.date) ?? [];
  const quiet = data.members.filter((m) => m.days.every((d) => !d.slots.length && !d.records.length && !d.onLeave));
  const members = showAll ? data.members : data.members.filter((m) => !quiet.includes(m));

  const mark = useMutation({
    mutationFn: (v: Vars) => api.post<{ changed: boolean }>('/attendance/register', v),
    onMutate: (v) => setPending(`${v.membershipId}:${v.date}`),
    onSettled: () => {
      setPending(null);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: async (e: Error, v) => {
      const name = data.members.find((m) => m.membershipId === v.membershipId)?.name ?? '';
      if (e instanceof ApiError && e.code === 'NOT_ROSTERED') {
        toast.info(`${name} isn’t rostered on ${dayLabel(v.date, 'EEE d MMM')} — enter the times they worked.`);
        onNeedTimes(v.membershipId, v.date);
        return;
      }
      if (e instanceof ApiError && e.code === 'REASON_REQUIRED') {
        const c = await confirm({
          title: `Untick ${name}?`,
          description: `${name} clocked in themselves on ${dayLabel(v.date, 'EEE d MMM')}. Unticking removes those clock times.`,
          destructive: true,
          confirmLabel: 'Untick',
          requireReason: true,
          reasonLabel: 'Reason',
        });
        if (c.confirmed && c.reason) mark.mutate({ ...v, reason: c.reason });
        return;
      }
      toast.error(e.message);
    },
  });

  const totals = (m: AttendanceMember) => {
    const past = m.days.filter((d) => d.date <= data.today && d.date >= data.trackedFrom);
    return { present: past.filter((d) => d.records.length).length, absent: past.filter((d) => d.status === 'ABSENT').length };
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-[170px] border-b bg-card px-3 py-2 text-left font-semibold">Staff</th>
              {days.map((date) => (
                <th key={date} className={cn('w-8 border-b px-0 py-1.5 text-center font-medium', date === data.today && 'bg-primary/10 text-primary')}>
                  <span className="block text-[10px] uppercase">{dayLabel(date, 'EEEEE')}</span>
                  <span className="block tabular">{Number(date.slice(8))}</span>
                </th>
              ))}
              <th className="border-b px-2 py-2 text-right font-semibold" title="Days present">Present</th>
              <th className="border-b px-2 py-2 text-right font-semibold" title="Days absent">Absent</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const t = totals(m);
              return (
                <tr key={m.membershipId}>
                  <td className="sticky left-0 z-10 border-b bg-card px-3 py-1.5">
                    <p className="truncate font-medium">{m.name}</p>
                    {m.jobTitle && <p className="truncate text-xs text-muted-foreground">{m.jobTitle}</p>}
                  </td>
                  {m.days.map((d) => {
                    const info = cellInfo(d, tz, data.today);
                    const key = `${m.membershipId}:${d.date}`;
                    const checked = d.records.length > 0;
                    const label = `${m.name}, ${dayLabel(d.date, 'EEE d MMM')}: ${info.title}`;
                    return (
                      <td key={d.date} className={cn('border-b px-0 py-1.5 text-center', TONES[info.tone], d.date === data.today && 'ring-1 ring-inset ring-primary/30')} title={info.title}>
                        {info.tone === 'leave' && !checked ? (
                          <span className="text-xs font-semibold text-info" aria-label={label}>
                            L
                          </span>
                        ) : (
                          <Checkbox
                            aria-label={label}
                            checked={checked}
                            disabled={d.date > data.today || pending === key}
                            onCheckedChange={(v) => mark.mutate({ membershipId: m.membershipId, date: d.date, present: v === true })}
                            className={cn('align-middle', info.tone === 'absent' && 'border-destructive/60')}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="border-b px-2 py-1.5 text-right tabular">{t.present}</td>
                  <td className={cn('border-b px-2 py-1.5 text-right tabular', t.absent > 0 && 'font-medium text-destructive')}>{t.absent}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {quiet.length > 0 && (
        <div className="border-t px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? `Hide ${quiet.length} not rostered this month` : `Show ${quiet.length} more (not rostered this month)`}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-success/30" /> Present</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-warning/40" /> Late or left early</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-destructive/25" /> Absent</span>
        <span className="flex items-center gap-1.5"><span className="font-semibold text-info">L</span> On leave</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-muted" /> Not rostered</span>
        <span>Tick a box to mark someone present for their rostered hours; untick to remove it. Hover a box for the times.</span>
      </div>
    </div>
  );
}
