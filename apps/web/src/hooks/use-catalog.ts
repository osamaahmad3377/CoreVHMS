'use client';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import type { AppointmentType, ClinicalTemplateRow, Clinician, Resource } from '@/lib/types';

export const useAppointmentTypes = (all = false) =>
  useQuery({ queryKey: ['appointment-types', all], queryFn: () => api.get<AppointmentType[]>(`/appointment-types${all ? '?all=true' : ''}`), staleTime: 120_000 });

export const useClinicians = (branchId?: string) =>
  useQuery({ queryKey: ['clinicians', branchId], queryFn: () => api.get<Clinician[]>(`/staff/clinicians${qs({ branchId })}`), staleTime: 120_000 });

export const useResources = (branchId?: string) =>
  useQuery({ queryKey: ['resources', branchId], queryFn: () => api.get<Resource[]>(`/resources${qs({ branchId })}`), staleTime: 120_000 });

export const useTemplates = () =>
  useQuery({ queryKey: ['clinical-templates'], queryFn: () => api.get<ClinicalTemplateRow[]>('/clinical-templates'), staleTime: 120_000 });
