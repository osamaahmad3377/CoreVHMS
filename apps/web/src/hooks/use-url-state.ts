'use client';
import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Keeps list filters/pagination/tabs in the URL so views are shareable and survive reloads.
 *
 * Updates use the native `history.replaceState`, which Next.js (14.1+) syncs into `useSearchParams`
 * straight away — the page re-renders instantly with no server round-trip (router.replace waited for
 * the RSC request, so tabs felt frozen under load). Back/forward keep working as before: replace
 * never adds history entries, and popstate is handled by the Next router.
 */
export function useUrlState() {
  const params = useSearchParams();
  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  const set = useCallback((updates: Record<string, string | number | null | undefined>) => {
    // Read the live URL rather than the last render's params, so two set() calls in one tick both apply.
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === '') sp.delete(k);
      else sp.set(k, String(v));
    }
    const s = sp.toString();
    const next = `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, '', next);
  }, []);
  return { get, set };
}
