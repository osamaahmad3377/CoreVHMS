import { enumLabel } from '@vcms/shared';
import { PawPrint, Scale, User } from 'lucide-react';
import Link from 'next/link';
import { HospitalStatusChip } from '../hospital/status-chip';
import { fmtAge, fmtWeight } from '@/lib/format';
import type { AlertSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertChip, StatusBadge } from '../status';

export interface BannerPatient {
  id: string;
  name: string;
  patientNo: string;
  status: string;
  sex: string;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  deceasedAt?: string | null;
  species: { name: string };
  breed?: string | { name: string } | null;
  breedText?: string | null;
  latestWeightKg: number | null;
  photoAttachmentId: string | null;
  owner: { id: string; displayName: string; mobilePhone?: string | null } | null;
  alerts: (AlertSummary & { isActive?: boolean })[];
}

/** Persistent patient identity strip with active medical alerts — shown at the top of every clinical screen. */
export function PatientBanner({ patient, className, compact }: { patient: BannerPatient; className?: string; compact?: boolean }) {
  const breed = typeof patient.breed === 'string' ? patient.breed : (patient.breed?.name ?? patient.breedText);
  const alerts = patient.alerts.filter((a) => a.isActive !== false);
  const critical = alerts.some((a) => a.severity === 'CRITICAL');
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center',
        critical && 'border-destructive/40 ring-1 ring-destructive/20',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-accent-foreground">
          {patient.photoAttachmentId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/v1/attachments/${patient.photoAttachmentId}/download?inline=1`} alt={`Photo of ${patient.name}`} className="h-full w-full object-cover" />
          ) : (
            <PawPrint className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/patients/${patient.id}`} className="truncate text-base font-semibold hover:underline">
              {patient.name}
            </Link>
            <span className="text-xs text-muted-foreground">{patient.patientNo}</span>
            {patient.status !== 'ACTIVE' && <StatusBadge status={patient.status} />}
            {patient.status === 'ACTIVE' && <HospitalStatusChip patientId={patient.id} />}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {patient.species.name}
            {breed && ` · ${breed}`} · {enumLabel(patient.sex)} · {fmtAge(patient.dateOfBirth, patient.dobEstimated, patient.deceasedAt)}
          </p>
        </div>
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:ml-4 sm:border-l sm:pl-4">
          <span className="flex items-center gap-1">
            <Scale className="h-3.5 w-3.5" /> {patient.latestWeightKg == null ? 'Weight: not recorded' : fmtWeight(patient.latestWeightKg)}
          </span>
          {patient.owner && (
            <Link href={`/clients/${patient.owner.id}`} className="flex items-center gap-1 hover:text-foreground">
              <User className="h-3.5 w-3.5" /> {patient.owner.displayName}
              {patient.owner.mobilePhone && ` · ${patient.owner.mobilePhone}`}
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1 sm:ml-auto sm:justify-end" aria-label="Medical alerts">
        {alerts.length ? alerts.map((a) => <AlertChip key={a.id} alert={a} />) : <span className="text-xs text-muted-foreground">No active alerts</span>}
      </div>
    </div>
  );
}
