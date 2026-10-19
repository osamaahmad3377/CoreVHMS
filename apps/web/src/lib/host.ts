'use client';
import { useQuery } from '@tanstack/react-query';
import type { HostInfo } from '@vcms/shared';
import { api } from './api';

/** Which part of the system this web address is: one clinic, the super admin area, or a single-clinic installation. */
export function useHostInfo() {
  return useQuery({
    queryKey: ['host-info'],
    queryFn: () => api.get<HostInfo>('/tenant'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
