'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Bed, Scissors } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ErrorState, LoadingRows } from '../page';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { BoardingStay, GroomingJob } from '@/lib/types';

/** The patient's Boarding & grooming tab: every stay and grooming job, newest first, each opening its own page. */
export function PatientBoarding({ patientId }: { patientId: string }) {
  const stays = useQuery({ queryKey: ['patient-stays', patientId], queryFn: () => api.get<BoardingStay[]>(`/boarding/stays?patientId=${patientId}`) });
  const jobs = useQuery({ queryKey: ['patient-grooming', patientId], queryFn: () => api.get<GroomingJob[]>(`/grooming/jobs?patientId=${patientId}`) });
  if (stays.error || jobs.error) {
    return (
      <ErrorState
        error={stays.error ?? jobs.error}
        onRetry={() => {
          stays.refetch();
          jobs.refetch();
        }}
      />
    );
  }
  if (stays.isLoading || jobs.isLoading) return <LoadingRows />;
  const s = [...(stays.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const g = jobs.data ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bed className="h-4 w-4" /> Boarding</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {s.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No boarding yet. Stays for this animal will appear here.</p>}
          {s.map((x) => (
            <Link key={x.id} href={`/boarding/stays/${x.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
              <span>
                <b>{x.stayNo}</b> · {fmtDate(x.startDate)} → {fmtDate(x.endDate)}
                <span className="block text-xs text-muted-foreground">
                  {x.unit ? x.unit.name : 'No kennel yet'}
                  {x.behaviourNotes ? ` · ${x.behaviourNotes.slice(0, 80)}` : ''}
                </span>
              </span>
              <Badge variant="outline">{enumLabel(x.status)}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Scissors className="h-4 w-4" /> Grooming</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {g.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No grooming yet. Grooming jobs for this animal will appear here.</p>}
          {g.map((j) => (
            <Link key={j.id} href={`/boarding/grooming/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
              <span>
                <b>{j.groomingNo}</b> · {fmtDate(j.createdAt)}
                <span className="block text-xs text-muted-foreground">
                  {j.services.map((x) => x.description).join(', ') || 'No services listed'}
                  {j.groomerNotes ? ` · ${j.groomerNotes.slice(0, 80)}` : ''}
                </span>
              </span>
              <Badge variant="outline">{enumLabel(j.status)}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
