'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock, FileSignature, Play, Stethoscope, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PriorityDot } from '@/components/scheduling/appointment-status';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { FrontDeskVisit, FrontDeskWidget } from './front-desk-panels';

export interface MyOpenConsultation {
  id: string;
  encounterNo: string;
  patient: string;
  species: string;
  chiefComplaint: string | null;
  startedAt: string;
}

/**
 * The vet's day in one place: the next patient waiting for them (or for any vet) with one big Start button,
 * their consultations still in progress to continue, and the notes left to sign.
 */
export function VetFocus({ frontDesk, myOpen, unsigned }: { frontDesk?: FrontDeskWidget; myOpen: MyOpenConsultation[]; unsigned: number }) {
  const { session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const me = session.user.name;
  // Waiting for me, or not assigned to anyone yet; longest wait first (the list arrives in that order).
  const mine = (frontDesk?.waiting ?? []).filter((v) => !v.clinician || v.clinician === me);
  const next: FrontDeskVisit | undefined = mine[0];
  const start = useMutation({
    mutationFn: (id: string) => api.post<{ encounterId: string | null }>(`/appointments/${id}/status`, { action: 'start' }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      if (a.encounterId) router.push(`/consultations/${a.encounterId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section aria-label="Your patients" className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {/* Next patient */}
      <div className={cn('surface relative overflow-hidden rounded-2xl p-6', next && 'ring-1 ring-primary/25')}>
        {next && <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gradient-to-br from-primary/25 to-brand-2/20 blur-3xl" />}
        <p className="relative text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{next ? 'Your next patient' : 'Waiting for you'}</p>
        {next ? (
          <div className="relative mt-3 flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[1.75rem] font-bold leading-tight tracking-tight">
                {next.priority && <PriorityDot priority={next.priority} />}
                <span className="truncate">{next.patient?.name ?? 'No patient yet'}</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {next.client?.displayName ?? 'Walk-in'} · {next.type.name}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                <Clock className="h-4 w-4" /> Waiting {next.checkedInAt ? fmtRelative(next.checkedInAt).replace(/ ago$/, '') : 'now'}
                {mine.length > 1 && <span className="font-normal text-muted-foreground"> · {mine.length - 1} more after</span>}
              </p>
            </div>
            <Button size="lg" className="w-full sm:w-auto" loading={start.isPending} onClick={() => start.mutate(next.id)}>
              <Play /> Start consultation
            </Button>
          </div>
        ) : (
          <div className="relative mt-3 flex flex-wrap items-center gap-4">
            <p className="min-w-0 flex-1 text-lg font-semibold">Nobody is waiting for you right now.</p>
            <Button variant="outline" asChild>
              <Link href="/consultations?start=1">
                <UserPlus /> See a walk-in
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* In progress + notes */}
      <div className="surface flex flex-col rounded-2xl">
        <div className="flex items-center justify-between gap-2 px-6 pb-2 pt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Still open</p>
          {unsigned > 0 && (
            <Link href="/consultations?mine=true" className="flex items-center gap-1 text-xs font-semibold text-warning hover:underline">
              <FileSignature className="h-3.5 w-3.5" /> {unsigned} note{unsigned === 1 ? '' : 's'} to sign
            </Link>
          )}
        </div>
        {myOpen.length ? (
          <ul className="divide-y divide-foreground/[0.05] pb-2">
            {myOpen.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link href={`/consultations/${c.id}`} className="group flex min-h-14 items-center gap-3 px-6 py-2.5 transition-colors hover:bg-[hsl(var(--glass)/0.5)]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Stethoscope className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.patient}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.chiefComplaint || c.species} · started {fmtRelative(c.startedAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                    Continue <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 pb-5 text-sm text-muted-foreground">No consultations in progress. Finished visits are under Consultations.</p>
        )}
      </div>
    </section>
  );
}
