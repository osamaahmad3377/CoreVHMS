'use client';
import { useQuery } from '@tanstack/react-query';
import { Clock, DoorOpen, UserPlus, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { type PickedPatient } from '@/components/patients/patient-picker';
import { RequirePermission } from '@/components/require';
import { fmtWait } from '@/components/scheduling/appointment-text';
import { NewVisitDialog } from '@/components/front-desk/new-visit-dialog';
import { BookingDialog } from '@/components/scheduling/booking-dialog';
import { QueueBoard, useQueue } from '@/components/scheduling/queue-board';
import { Stat } from '@/components/stat';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { dayLabel } from '@/lib/time';
import type { PatientDetail } from '@/lib/types';

function FrontDesk() {
  const { session, can } = useSession();
  const router = useRouter();
  const q = useQueue();
  // New visit: find the owner and animal, then the waiting queue or a booking. /front-desk?visit=1 opens it.
  const params = useSearchParams();
  const [walkIn, setWalkIn] = useState(() => params.get('visit') === '1');
  // "Check in now" after registering a patient: /front-desk?walkIn=<patientId> opens it for them.
  const walkInId = params.get('walkIn');
  const walkInPatient = useQuery({
    queryKey: ['patient', walkInId],
    queryFn: () => api.get<PatientDetail>(`/patients/${walkInId}`),
    enabled: !!walkInId && can('appointments.checkin'),
  });
  const [preset, setPreset] = useState<PickedPatient | null>(null);
  useEffect(() => {
    const d = walkInPatient.data;
    if (!d) return;
    setPreset({
      id: d.id,
      name: d.name,
      patientNo: d.patientNo,
      species: d.species,
      owner: d.owner ? { id: d.owner.id, displayName: d.owner.displayName, mobilePhone: d.owner.mobilePhone } : null,
      alerts: d.alerts.filter((a) => a.isActive),
    });
    setWalkIn(true);
    router.replace('/front-desk');
  }, [walkInPatient.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [book, setBook] = useState(false);
  const [bookFor, setBookFor] = useState<PickedPatient | null>(null);
  useEffect(() => {
    if (params.get('visit') === '1') router.replace('/front-desk');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        help="front-desk"
        title="Front desk"
        description={q.data ? `${dayLabel(q.data.date, 'EEEE d MMMM')} · ${session.branch?.name}` : session.branch?.name}
        actions={
          <>
            {/* One start for every visit: find the owner and animal, then the waiting queue or a booking. */}
            {(can('appointments.checkin') || can('appointments.write')) && (
              <Button size="sm" onClick={() => setWalkIn(true)}>
                <UserPlus /> New visit or booking
              </Button>
            )}
          </>
        }
      />
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Patients today" value={q.data!.stats.total} icon={Users} />
            <Stat label="Waiting now" value={q.data!.waiting.length} icon={Clock} tone={q.data!.waiting.length ? 'warning' : 'default'} />
            <Stat label="Average wait" value={fmtWait(q.data!.stats.averageWaitMinutes)} icon={Clock} tone={q.data!.stats.averageWaitMinutes >= 30 ? 'danger' : 'default'} />
            <Stat label="No-shows" value={q.data!.stats.noShows} icon={DoorOpen} />
          </div>
          {/* Consultations are started from Consultations, not here. */}
          <QueueBoard columns={['expected', 'waiting', 'inConsultation', 'done']} allowStart={false} />
          <p className="mt-2 text-right text-2xs text-muted-foreground">Refreshes every 30 seconds · waiting list sorted by triage priority, then arrival time</p>
        </>
      )}
      <NewVisitDialog
        open={walkIn}
        onOpenChange={(o) => {
          setWalkIn(o);
          if (!o) setPreset(null);
        }}
        initialPatient={preset}
        initialAction="queue"
        allowConsult={false}
        onBook={(p) => {
          setBookFor(p);
          setBook(true);
        }}
      />
      <BookingDialog open={book} onOpenChange={setBook} defaults={bookFor ? { patient: bookFor } : undefined} />
    </>
  );
}

export default function FrontDeskPage() {
  return (
    <RequirePermission anyOf={['appointments.checkin', 'appointments.read']}>
      <Suspense>
        <FrontDesk />
      </Suspense>
    </RequirePermission>
  );
}
