'use client';
import { useQuery } from '@tanstack/react-query';
import { HeartHandshake, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { EnrolDialog, MembershipCard, WellnessStateBadge } from './membership';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PatientWellness } from '@/lib/types';

/** Patient tab: the current plan (and the renewal waiting to start), past plans, and joining a plan. */
export function PatientWellnessTab({ patientId, patientName, active }: { patientId: string; patientName: string; active: boolean }) {
  const { can, currency } = useSession();
  const [enrolling, setEnrolling] = useState(false);
  const q = useQuery({ queryKey: ['patient-wellness', patientId], queryFn: () => api.get<PatientWellness>(`/patients/${patientId}/wellness`) });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const canEnrol = active && can('wellness.enrol') && !d.current && d.availablePlans.length > 0;
  // A plan that ended without renewing: offer to renew it (no joining fee) as well as joining afresh.
  const lapsed = !d.current && !d.upcoming ? d.history.find((h) => h.state === 'EXPIRED' && !h.renewedTo) : undefined;

  return (
    <div className="grid gap-4">
      {d.current && <MembershipCard e={d.current} plans={d.availablePlans} />}
      {d.upcoming && <MembershipCard e={d.upcoming} plans={d.availablePlans} compact={!!d.current} />}
      {lapsed && active && <MembershipCard e={lapsed} plans={d.availablePlans} compact />}
      {!d.current && !d.upcoming && (
        <Card>
          <EmptyState
            icon={HeartHandshake}
            title={`${patientName} isn’t on a wellness plan`}
            description={
              d.availablePlans.length
                ? 'A plan covers routine care for a year — check-ups, vaccinations, a dental clean — paid up front or monthly, with a discount on everything else.'
                : can('wellness.manage')
                  ? 'No plans are set up for this species yet. Create one under Wellness plans → Plans.'
                  : 'The clinic has no wellness plans for this species yet.'
            }
            action={
              canEnrol ? (
                <Button onClick={() => setEnrolling(true)}>
                  <Plus /> Join a plan
                </Button>
              ) : !d.availablePlans.length && can('wellness.manage') ? (
                <Button variant="outline" asChild>
                  <Link href="/wellness?tab=plans">Set up plans</Link>
                </Button>
              ) : undefined
            }
            className="py-10"
          />
        </Card>
      )}

      {!!d.history.length && (
        <Card>
          <CardHeader><CardTitle>Earlier plans</CardTitle></CardHeader>
          <ul className="divide-y border-t">
            {d.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{h.planName}</span>
                  <span className="text-muted-foreground"> · {h.enrolmentNo} · {fmtDate(h.startDate)} – {fmtDate(h.endDate)}</span>
                </span>
                <span className="text-xs text-success">saved {fmtMoney(h.savedMinor, currency)}</span>
                <WellnessStateBadge state={h.state} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <EnrolDialog patientId={patientId} patientName={patientName} plans={d.availablePlans} today={d.today} open={enrolling} onOpenChange={setEnrolling} />
    </div>
  );
}
