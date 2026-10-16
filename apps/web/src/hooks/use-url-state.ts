'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/** Keeps list filters/pagination in the URL so views are shareable and survive reloads. */
export function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  const set = useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === '') sp.delete(k);
        else sp.set(k, String(v));
      }
      const s = sp.toString();
      router.replace(`${pathname}${s ? `?${s}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return { get, set };
}
