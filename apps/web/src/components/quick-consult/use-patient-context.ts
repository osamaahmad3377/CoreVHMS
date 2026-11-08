'use client';
import { useQuery } from '@tanstack/react-query';
import type { PatientHistorySummary } from '@vcms/shared';
import { api } from '@/lib/api';

type Row = Record<string, any>;
interface PastData {
  sections: { name: string; data: any }[];
}

export interface LastVisit {
  id: string;
  encounterNo: string;
  at: string;
  clinician: string | null;
  complaint: string | null;
  diagnoses: { term: string; code: string | null; codeSystem: string | null }[];
  plan: string | null;
  advice: string | null;
  medicines: string[];
}

/**
 * What the companion knows about the patient before the vet starts: the last visit (problem, diagnosis, plan,
 * medicines), the last weight, and the earlier care summary. Read from the same cached record as "Past records".
 */
export function usePatientContext(patientId: string, encounterId: string) {
  const record = useQuery({ queryKey: ['patient-record', patientId], queryFn: () => api.get<PastData>(`/patients/${patientId}/record`), staleTime: 30_000 });
  const summary = useQuery({ queryKey: ['history-summary', patientId, encounterId], queryFn: () => api.get<PatientHistorySummary>(`/patients/${patientId}/history-summary?exclude=${encounterId}`), staleTime: 60_000 });

  const section = (name: string): Row[] => (record.data?.sections.find((s) => s.name === name)?.data as Row[] | undefined) ?? [];
  const visits = section('consultations')
    .filter((c) => c.id !== encounterId && c.status !== 'CANCELLED')
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const prescriptions = section('prescriptions');

  const last = visits[0];
  let lastVisit: LastVisit | null = null;
  if (last) {
    const note = (last.notes ?? []).filter((n: Row) => n.status === 'SIGNED').sort((a: Row, b: Row) => b.version - a.version)[0] as Row | undefined;
    const meds = prescriptions
      .filter((p) => p.encounterId === last.id && p.status !== 'CANCELLED')
      .flatMap((p) => (p.items ?? []).map((i: Row) => String(i.product?.name ?? i.name ?? i.productName ?? '').trim()))
      .filter(Boolean);
    lastVisit = {
      id: last.id,
      encounterNo: last.encounterNo,
      at: last.startedAt,
      clinician: last.clinician ?? null,
      complaint: last.chiefComplaint ?? note?.presentingComplaint ?? null,
      diagnoses: (last.diagnoses ?? []).filter((d: Row) => d.status !== 'RULED_OUT').map((d: Row) => ({ term: d.term, code: d.code ?? null, codeSystem: d.codeSystem ?? null })),
      plan: note?.plan ?? null,
      advice: note?.followUpInstructions ?? null,
      medicines: [...new Set(meds)] as string[],
    };
  }

  // The most recent weight measured at an earlier visit.
  let lastWeight: { kg: number; at: string } | null = null;
  for (const c of visits) {
    const v = [...(c.vitals ?? [])].reverse().find((x: Row) => x.weightKg != null);
    if (v) {
      lastWeight = { kg: Number(v.weightKg), at: v.recordedAt };
      break;
    }
  }

  return { ready: !record.isLoading, lastVisit, lastWeight, visitCount: visits.length, careSummary: summary.data?.sections ?? [] };
}

/** "4 years 2 months", "7 months", "3 weeks" from a date of birth. */
export function ageText(dob: string | null | undefined, estimated?: boolean) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  const prefix = estimated ? 'about ' : '';
  if (months < 1) return `${prefix}${Math.max(0, Math.floor((now.getTime() - d.getTime()) / (7 * 86_400_000)))} weeks`;
  if (months < 24) return `${prefix}${months} month${months === 1 ? '' : 's'}`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${prefix}${y} years${m ? ` ${m} month${m === 1 ? '' : 's'}` : ''}`;
}
