'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TimelineEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
  severity?: string;
  href?: string;
}

const TIMELINE_KIND_LABEL: Record<string, string> = {
  registration: 'Registration',
  weight: 'Weight',
  alert: 'Alerts',
  ownership: 'Ownership',
  document: 'Documents',
  appointment: 'Appointments',
  consultation: 'Consultations',
  vitals: 'Vital signs',
  prescription: 'Prescriptions',
  medication: 'Medications',
  lab: 'Lab',
  preventive: 'Vaccines & preventive care',
  hospital: 'Hospital',
  surgery: 'Surgery',
  boarding: 'Boarding',
  grooming: 'Grooming',
  breeding: 'Breeding',
  'livestock-movement': 'Movements',
  'insurance-claim': 'Insurance claims',
  referral: 'Referrals',
  billing: 'Billing',
};
const timelineKindLabel = (k: string) => TIMELINE_KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/[-_]/g, ' ');

export function TimelineTab({ patientId }: { patientId: string }) {
  const [kind, setKind] = useState<string>('');
  const fetchTimeline = (k: string) => api.get<{ kinds: string[]; events: TimelineEvent[] }>(`/patients/${patientId}/timeline${k ? `?kinds=${k}` : ''}`);
  // The unfiltered list decides which filters to offer, so a dog never sees "Movements" or "Insurance claims" with nothing behind them.
  const all = useQuery({ queryKey: ['timeline', patientId, ''], queryFn: () => fetchTimeline('') });
  const filtered = useQuery({ queryKey: ['timeline', patientId, kind], queryFn: () => fetchTimeline(kind), enabled: !!kind });
  const q = kind ? filtered : all;
  if (q.isLoading || all.isLoading) return <LoadingRows rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { kinds, events } = q.data!;
  const present = kinds.filter((k) => k === kind || all.data?.events.some((e) => e.kind === k));
  return (
    <Card>
      {present.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b p-3">
          {['', ...present].map((k) => (
            <Button key={k || 'all'} size="sm" variant={kind === k ? 'default' : 'ghost'} onClick={() => setKind(k)}>
              {k ? timelineKindLabel(k) : 'All'}
            </Button>
          ))}
        </div>
      )}
      <CardContent>
        {events.length ? (
          <ol className="relative grid gap-4 border-l pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card',
                    e.severity === 'CRITICAL' ? 'bg-destructive' : e.severity === 'WARNING' ? 'bg-warning' : 'bg-primary',
                  )}
                />
                <p className="text-sm font-medium">{e.href ? <Link href={e.href} className="hover:underline">{e.title}</Link> : e.title}</p>
                {e.detail && <p className="text-sm text-muted-foreground">{e.detail}</p>}
                <p className="text-xs text-muted-foreground">
                  {timelineKindLabel(e.kind)} · {fmtDateTime(e.at)}
                  {e.actor && ` · ${e.actor}`}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="No events" />
        )}
      </CardContent>
    </Card>
  );
}

