'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Moon, Sun, Sunrise } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../page';
import { Skeleton } from '../ui/misc';
import { api, qs } from '@/lib/api';
import { branchTime, dayLabel, minuteOfDay, shiftDate, todayIn } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { FreeTime } from './booking-types';

const PERIODS = [
  { key: 'morning', label: 'Morning', icon: Sunrise, test: (m: number) => m < 12 * 60 },
  { key: 'afternoon', label: 'Afternoon', icon: Sun, test: (m: number) => m >= 12 * 60 && m < 17 * 60 },
  { key: 'evening', label: 'Evening', icon: Moon, test: (m: number) => m >= 17 * 60 },
] as const;

/**
 * Day strip (two weeks at a time; full days greyed out) and the free times of the chosen day, grouped into
 * morning, afternoon and evening. Times are shown in the branch's own time zone.
 */
export function SlotPicker({
  slug,
  branchId,
  appointmentTypeId,
  clinicianId,
  timezone,
  value,
  onChange,
}: {
  slug: string;
  branchId: string;
  appointmentTypeId: string;
  clinicianId?: string;
  timezone: string;
  value: FreeTime | null;
  onChange: (t: FreeTime | null) => void;
}) {
  const today = todayIn(timezone);
  const [from, setFrom] = useState(today);
  const [date, setDate] = useState<string | null>(null);
  const base = { branchId, appointmentTypeId, clinicianId: clinicianId ?? '' };
  const days = useQuery({
    queryKey: ['public-days', slug, base, from],
    queryFn: () => api.get<{ days: { date: string; free: number }[]; lastDate: string }>(`/public/booking/${slug}/days${qs({ ...base, from, count: 14 })}`),
    staleTime: 30_000,
  });
  // Start on the first day with free times; when two whole weeks are full, look further ahead by itself.
  const [searching, setSearching] = useState(true);
  useEffect(() => {
    if (!days.data) return;
    const first = days.data.days.find((d) => d.free > 0)?.date ?? null;
    const more = days.data.days.length === 14 && shiftDate(from, 14) <= days.data.lastDate;
    if (!first && more && searching) {
      setFrom(shiftDate(from, 14));
      return;
    }
    setSearching(false);
    if (!date || !days.data.days.some((d) => d.date === date)) setDate(first);
  }, [days.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const slots = useQuery({
    queryKey: ['public-slots', slug, base, date],
    queryFn: () => api.get<FreeTime[]>(`/public/booking/${slug}/slots${qs({ ...base, date: date! })}`),
    enabled: !!date,
    staleTime: 15_000,
  });
  const strip = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => PERIODS.map((p) => ({ ...p, times: (slots.data ?? []).filter((t) => p.test(minuteOfDay(t.startsAt, timezone))) })).filter((g) => g.times.length), [slots.data, timezone]);
  const canBack = from > today;
  const canForward = !!days.data && days.data.days.length === 14 && shiftDate(from, 14) <= days.data.lastDate;

  if (days.error) return <ErrorState error={days.error} onRetry={() => days.refetch()} />;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" aria-label="Earlier days" disabled={!canBack} onClick={() => setFrom(shiftDate(from, -14) < today ? today : shiftDate(from, -14))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full surface-flat transition disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div ref={strip} role="listbox" aria-label="Day" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.isLoading || searching
            ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[76px] w-16 shrink-0 rounded-2xl" />)
            : days.data!.days.map((d) => {
                const on = d.date === date;
                const full = d.free === 0;
                return (
                  <button
                    key={d.date}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={full}
                    onClick={() => {
                      setDate(d.date);
                      onChange(null);
                    }}
                    className={cn(
                      'flex h-[76px] w-16 shrink-0 flex-col items-center justify-center rounded-2xl border text-center transition-all duration-200 ease-apple',
                      on ? 'border-primary bg-primary text-primary-foreground shadow-glow' : full ? 'border-transparent bg-foreground/[0.03] text-muted-foreground/50' : 'surface-flat hover:-translate-y-0.5 hover:border-primary/40',
                    )}
                  >
                    <span className="text-2xs font-semibold uppercase tracking-wide">{d.date === today ? 'Today' : dayLabel(d.date, 'EEE')}</span>
                    <span className="text-xl font-bold leading-tight">{dayLabel(d.date, 'd')}</span>
                    <span className="text-2xs">{full ? 'Full' : dayLabel(d.date, 'MMM')}</span>
                  </button>
                );
              })}
        </div>
        <button type="button" aria-label="Later days" disabled={!canForward} onClick={() => setFrom(shiftDate(from, 14))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full surface-flat transition disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {date && (
        <div className="grid gap-4">
          <p className="text-sm font-semibold">{dayLabel(date, 'EEEE d MMMM')}</p>
          {slots.isLoading ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : !grouped.length ? (
            <p className="rounded-2xl surface-flat p-5 text-center text-sm text-muted-foreground">No free times left on this day. Please choose another day.</p>
          ) : (
            grouped.map((g) => (
              <div key={g.key} className="grid gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  <g.icon className="h-3.5 w-3.5" /> {g.label}
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {g.times.map((t) => {
                    const on = value?.startsAt === t.startsAt;
                    return (
                      <button
                        key={t.startsAt}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onChange(t)}
                        className={cn('h-12 rounded-xl text-sm font-semibold tabular transition-all duration-200 ease-apple', on ? 'bg-primary text-primary-foreground shadow-glow' : 'surface-flat hover:border-primary/50 hover:text-primary')}
                      >
                        {branchTime(t.startsAt, timezone, 'h:mm a')}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {!days.isLoading && !searching && !date && (
        <p className="rounded-2xl surface-flat p-5 text-center text-sm text-muted-foreground">
          {from === today ? 'No free times are open online for this choice. Try another vet or service, or call the clinic.' : 'No free times in these two weeks. Use the arrows to see other days, or call the clinic.'}
        </p>
      )}
    </div>
  );
}
