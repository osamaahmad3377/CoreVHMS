import type { HostInfo } from '@vcms/shared';
import { headers } from 'next/headers';
import { cache } from 'react';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Server side: which clinic this address belongs to, with its branding, so the first paint already has the
 * clinic's colours, name and icon. Fails soft (default branding) if the API cannot be reached.
 */
export const hostInfo = cache(async (): Promise<HostInfo | null> => {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  try {
    const res = await fetch(`${API_URL}/api/v1/tenant`, {
      headers: { 'x-forwarded-host': host },
      // Not cached: an owner who saves new branding sees it on the sign-in page straight away.
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as HostInfo) : null;
  } catch {
    return null;
  }
});
