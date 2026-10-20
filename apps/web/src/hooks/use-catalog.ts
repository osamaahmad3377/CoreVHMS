'use client';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { AppointmentType, ClinicalTemplateRow, Clinician, NotePhraseRow, Resource } from '@/lib/types';

export const useAppointmentTypes = (all = false) =>
  useQuery({ queryKey: ['appointment-types', all], queryFn: () => api.get<AppointmentType[]>(`/appointment-types${all ? '?all=true' : ''}`), staleTime: 120_000 });

export const useClinicians = (branchId?: string) =>
  useQuery({ queryKey: ['clinicians', branchId], queryFn: () => api.get<Clinician[]>(`/staff/clinicians${qs({ branchId })}`), staleTime: 120_000 });

export const useResources = (branchId?: string) =>
  useQuery({ queryKey: ['resources', branchId], queryFn: () => api.get<Resource[]>(`/resources${qs({ branchId })}`), staleTime: 120_000 });

/** The one-tap phrases under the consultation note fields (the clinic's own list). */
export const useNotePhrases = (enabled = true) =>
  useQuery({ queryKey: ['note-phrases'], queryFn: () => api.get<NotePhraseRow[]>('/note-phrases'), staleTime: 120_000, enabled });

export const useTemplates = () =>
  useQuery({ queryKey: ['clinical-templates'], queryFn: () => api.get<ClinicalTemplateRow[]>('/clinical-templates'), staleTime: 120_000 });

export interface StaffOption {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  isClinician?: boolean;
}

/**
 * Every active staff member at a branch (not only vets), for assigning non-clinical work such as a groomer.
 * Uses the roster (staff.read / appointments.read); users without either fall back to the clinician list.
 */
export function useActiveStaff(branchId: string | undefined, canReadRoster: boolean) {
  const roster = useQuery({
    queryKey: ['active-staff', branchId],
    queryFn: () => {
      const now = new Date();
      return api.get<StaffOption[]>(`/schedules/roster${qs({ branchId, from: now.toISOString(), to: new Date(now.getTime() + 60_000).toISOString() })}`);
    },
    enabled: !!branchId && canReadRoster,
    staleTime: 120_000,
  });
  const clinicians = useQuery({
    queryKey: ['clinicians', branchId],
    queryFn: () => api.get<Clinician[]>(`/staff/clinicians${qs({ branchId })}`),
    enabled: !canReadRoster,
    staleTime: 120_000,
  });
  const q = canReadRoster ? roster : clinicians;
  const data = q.data ? [...q.data].map((s) => ({ membershipId: s.membershipId, name: s.name, jobTitle: s.jobTitle })).sort((a, b) => a.name.localeCompare(b.name)) : undefined;
  return { data, isLoading: q.isLoading };
}
