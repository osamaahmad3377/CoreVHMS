import type { ApiErrorBody } from '@vcms/shared';
import { ApiError } from './api';

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

/** API client for the client portal: portal session + portal CSRF cookie, redirects to the portal sign-in. */
async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = readCookie('vcms_pcsrf');
  let res: Response;
  try {
    res = await fetch(`/api/v1/portal${path}`, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the clinic. Check your connection and try again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) window.location.href = '/portal/login';
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const portalApi = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
};

export interface PortalSession {
  user: { id: string; email: string; name: string };
  client: { id: string; displayName: string };
  clinic: { id: string; name: string; currency: string; phone: string | null; email: string | null; defaultTimezone: string; portalCancelHours: number };
  clinics: { accessId: string; name: string }[];
}
