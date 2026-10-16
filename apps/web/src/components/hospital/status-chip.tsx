'use client';
import { useQuery } from '@tanstack/react-query';
import { BedDouble, Scissors } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface HospitalStatus {
  admission: { id: string; admissionNo: string; condition: string; cprStatus: string; ward: string | null; cage: string | null } | null;
  surgery: { id: string; surgeryNo: string; status: string; procedure: string } | null;
}

/** Shows where the patient is right now (in hospital, in surgery), so every screen reflects it. */
export function HospitalStatusChip({ patientId }: { patientId: string }) {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['hospital-status', patientId], queryFn: () => api.get<HospitalStatus>(`/patients/${patientId}/hospital-status`), enabled: can('patients.read'), staleTime: 30_000 });
  const a = q.data?.admission;
  const s = q.data?.surgery;
  if (!a && !s) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {s && (
        <Link href={can('surgery.read') ? `/surgery/${s.id}` : '#'} className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/30">
          <Scissors className="h-3 w-3" /> {s.status === 'IN_PROGRESS' ? 'In surgery' : s.status === 'RECOVERY' ? 'In recovery' : 'Pre-op'}
        </Link>
      )}
      {a && (
        <Link
          href={can('hospital.read') ? `/hospital/admissions/${a.id}` : '#'}
          className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1', a.condition === 'CRITICAL' ? 'bg-destructive/12 text-destructive ring-destructive/30' : 'bg-info/10 text-info ring-info/25')}
        >
          <BedDouble className="h-3 w-3" /> In hospital{a.ward ? ` · ${a.ward}${a.cage ? ` ${a.cage}` : ''}` : ''}{a.cprStatus === 'DNR' ? ' · DNR' : ''}
        </Link>
      )}
    </span>
  );
}
