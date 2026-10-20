'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { ArrowRight, BedDouble, CalendarPlus, CheckCircle2, Home, Scissors, Send } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AdmitDialog } from '../hospital/admit-dialog';
import { ReferralDialog } from '../insurance/dialogs';
import { ScheduleSurgeryDialog } from '../surgery/schedule-dialog';
import { Button } from '../ui/button';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useModuleOn, useSession } from '@/lib/session';
import type { Admission, Encounter, Surgery } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface OutcomeState {
  admitted: boolean;
  surgeries: number;
  referred: number;
}

function Option({ icon: Icon, title, text, done, children }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border p-4', done ? 'border-success/40 bg-success/5' : 'bg-card')}>
      <div className="flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', done ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary')}>
          {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{text}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * "Where does the patient go next?" — admit to hospital, schedule surgery, refer to a specialist or book a
 * follow-up, without leaving the consultation. Each choice shows what has already been arranged.
 */
export function VisitOutcome({
  encounter: e,
  admitOpen,
  onAdmitOpen,
  surgeryOpen,
  onSurgeryOpen,
  referOpen,
  onReferOpen,
  onBookFollowUp,
  onState,
}: {
  encounter: Encounter;
  admitOpen: boolean;
  onAdmitOpen: (o: boolean) => void;
  surgeryOpen: boolean;
  onSurgeryOpen: (o: boolean) => void;
  referOpen: boolean;
  onReferOpen: (o: boolean) => void;
  onBookFollowUp?: () => void;
  onState: (s: OutcomeState) => void;
}) {
  const { can } = useSession();
  const moduleOn = useModuleOn();
  const qc = useQueryClient();
  const hospital = moduleOn('hospital') && can('hospital.read');
  const surgery = moduleOn('surgery') && can('surgery.read');
  const insurance = moduleOn('insurance') && can('insurance.write');
  const [referrals, setReferrals] = useState<{ id: string; referralNo: string }[]>([]);

  const stay = useQuery({
    queryKey: ['admissions', 'current', e.patient.id],
    queryFn: () => api.get<{ data: { id: string; admissionNo: string; admittedAt: string }[] }>(`/admissions${qs({ patientId: e.patient.id, status: 'ADMITTED', pageSize: 1 })}`),
    enabled: hospital,
  });
  const ops = useQuery({
    queryKey: ['surgeries', 'patient', e.patient.id],
    queryFn: () => api.get<Surgery[]>(`/surgeries${qs({ patientId: e.patient.id, status: 'SCHEDULED,PRE_OP,IN_PROGRESS,RECOVERY' })}`),
    enabled: surgery,
  });
  const current = stay.data?.data[0];
  const upcoming = ops.data ?? [];
  useEffect(() => {
    onState({ admitted: !!current, surgeries: upcoming.length, referred: referrals.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!current, upcoming.length, referrals.length]);

  const patient = e.patient as never;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admissions'] });
    qc.invalidateQueries({ queryKey: ['surgeries'] });
    qc.invalidateQueries({ queryKey: ['encounter', e.id] });
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {hospital && (
          <Option icon={BedDouble} title="Admit to hospital" text="Keep the patient in a ward for treatment and watching." done={!!current}>
            {current ? (
              <>
                <span className="text-xs font-medium text-success">Admitted — {current.admissionNo}</span>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/hospital/admissions/${current.id}`}>Open treatment sheet <ArrowRight /></Link>
                </Button>
              </>
            ) : can('hospital.write') ? (
              <Button size="sm" onClick={() => onAdmitOpen(true)}>Admit to hospital</Button>
            ) : (
              <span className="text-xs text-muted-foreground">Your role cannot admit patients.</span>
            )}
          </Option>
        )}
        {surgery && (
          <Option icon={Scissors} title="Surgery" text="Book the theatre and the surgeon for an operation." done={upcoming.length > 0}>
            {upcoming.map((s) => (
              <Link key={s.id} href={`/surgery/${s.id}`} className="w-full rounded-md border bg-card px-2.5 py-1.5 text-xs hover:border-primary/50">
                <span className="font-medium">{s.procedure}</span> · {fmtDateTime(s.scheduledAt)} · {enumLabel(s.status)}
              </Link>
            ))}
            {can('surgery.write') && (
              <Button size="sm" variant={upcoming.length ? 'outline' : 'default'} onClick={() => onSurgeryOpen(true)}>
                {upcoming.length ? 'Schedule another' : 'Schedule surgery'}
              </Button>
            )}
          </Option>
        )}
        {insurance && (
          <Option icon={Send} title="Refer to a specialist" text="Send the patient and a summary of this visit to another vet." done={referrals.length > 0}>
            {referrals.map((r) => (
              <Link key={r.id} href={`/insurance/referrals/${r.id}`} className="text-xs font-medium text-success underline">
                Referral {r.referralNo} saved
              </Link>
            ))}
            <Button size="sm" variant={referrals.length ? 'outline' : 'default'} onClick={() => onReferOpen(true)}>
              {referrals.length ? 'Another referral' : 'Refer to a specialist'}
            </Button>
          </Option>
        )}
        {onBookFollowUp && (
          <Option icon={CalendarPlus} title="Book a follow-up visit" text="A recheck appointment for this patient." done={e.tasks.some((t) => t.type === 'RECHECK')}>
            <Button size="sm" variant="outline" onClick={onBookFollowUp}>Book follow-up</Button>
          </Option>
        )}
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
        <Home className="h-4 w-4 shrink-0" />
        <span>If none of these apply, the patient goes home. Write the advice for the client in the next step.</span>
      </div>

      {hospital && can('hospital.write') && (
        <AdmitDialog open={admitOpen} onOpenChange={onAdmitOpen} patient={patient} encounterId={e.id} onAdmitted={(a: Admission) => { refresh(); void a; }} />
      )}
      {surgery && can('surgery.write') && <ScheduleSurgeryDialog open={surgeryOpen} onOpenChange={onSurgeryOpen} patient={patient} onScheduled={refresh} />}
      {insurance && <ReferralDialog open={referOpen} onOpenChange={onReferOpen} patient={{ id: e.patient.id, name: e.patient.name }} onSaved={(r) => setReferrals((x) => [...x, { id: r.id, referralNo: r.referralNo }])} />}
    </div>
  );
}
