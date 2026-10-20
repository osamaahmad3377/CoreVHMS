import type { ApiErrorBody } from '@vcms/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }

  /** Field errors from VALIDATION_ERROR responses, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'VALIDATION_ERROR' || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

let activeBranchId: string | null = null;
export function setActiveBranch(id: string | null) {
  activeBranchId = id;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = readCookie('vcms_csrf');
  if (activeBranchId) headers['X-Branch-Id'] = activeBranchId;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(res.status, err?.code ?? 'ERROR', plainMessage(res.status, err?.code, err?.message), err?.details, err?.requestId);
  }
  return data as T;
}

/**
 * Turns the server's technical wording into short sentences a non-technical person can act on.
 * Specific messages written for people (e.g. "Temperature must be between 25 and 46 °C") pass through unchanged.
 */
export function plainMessage(status: number, code: string | undefined, message: string | undefined): string {
  const m = message ?? '';
  const tryAgain = 'Please try again. If it keeps happening, tell your clinic manager and give them the reference below.';
  if (code === 'VALIDATION_ERROR' || m === 'The request contains invalid data') return 'Some details are missing or need fixing. Check the fields marked in red.';
  if (code === 'INTERNAL_ERROR' || m === 'An unexpected error occurred') return `Something went wrong on our side. ${tryAgain}`;
  if (status === 429 || code === 'RATE_LIMITED') return 'Too many tries in a short time. Wait a minute, then try again.';
  if (status === 413 || code === 'PAYLOAD_TOO_LARGE') return 'That file is too big. Try a smaller one.';
  if (code === 'REFERENCE_CONFLICT') return 'This cannot be removed or changed because other records still use it.';
  if (m === 'Record not found') return 'We could not find that. It may have been removed. Go back and refresh the page.';
  const dup = /^A record with the same (.+) already exists$/.exec(m);
  if (dup) return `Something with the same ${dup[1].replace(/[_,]/g, ' ').trim()} already exists. Use a different one, or open the existing one.`;
  if (status === 403 && (m === 'Access denied' || m === 'Forbidden' || m === 'Forbidden resource' || !m)) return 'Your role does not allow this. Ask your clinic owner or manager if you need it.';
  if (status === 401 && !m) return 'Please sign in again.';
  if (status >= 500 && (!m || /^Request failed|^Bad Gateway|^Service Unavailable|^Gateway Timeout/i.test(m))) return 'The system is busy or restarting. Wait a moment, then try again.';
  return m || `Something went wrong (${status}). ${tryAgain}`;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
