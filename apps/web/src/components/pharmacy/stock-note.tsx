'use client';
import { useQuery } from '@tanstack/react-query';
import { PackageX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { api, qs } from '@/lib/api';
import { qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface AvailableBatches {
  product: { id: string; name: string; dispensingUnit: string; trackStock: boolean };
  location: { id: string; name: string } | null;
  batches: { onHand: number }[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Usable stock of a product at this branch, and whether it covers `quantity`. Shares its query with the batch
 * picker. Products whose stock is not tracked here are never short.
 */
export function useStock(productId: string | null | undefined, quantity?: number | null) {
  const { session } = useSession();
  const q = useQuery({
    queryKey: ['product-batches', productId, session.branch?.id],
    queryFn: () => api.get<AvailableBatches>(`/products/${productId}/batches${qs({ branchId: session.branch?.id })}`),
    enabled: !!productId,
    staleTime: 30_000,
  });
  const d = q.data;
  const tracked = !!d?.product.trackStock && !!d.location;
  const onHand = round((d?.batches ?? []).reduce((s, b) => s + b.onHand, 0));
  const unit = d?.product.dispensingUnit ?? '';
  const need = quantity && quantity > 0 ? round(quantity) : null;
  const short = tracked && (onHand <= 0 || (need !== null && onHand + 1e-9 < need));
  const text = !tracked
    ? ''
    : onHand <= 0
      ? `${d!.product.name} is out of stock at ${d!.location!.name}.`
      : short
        ? `Only ${qtyUnit(onHand, unit)} of ${d!.product.name} in stock at ${d!.location!.name}, ${qtyUnit(need!, unit)} needed.`
        : `${qtyUnit(onHand, unit)} in stock.`;
  return { ready: !!d, tracked, short, text };
}

/**
 * A one-line stock check under a medicine: a warning when there is not enough, otherwise how much is in stock.
 * `onShort` reports the warning text (or null) so the form can ask for a reason before saving.
 */
export function StockNote({ productId, quantity, after, onShort, quiet }: { productId: string | null | undefined; quantity?: number | null; /** Said after the warning, e.g. what happens next. */ after?: string; onShort?: (text: string | null) => void; /** The form shows the warning itself (with a reason field). */ quiet?: boolean }) {
  const s = useStock(productId, quantity);
  const report = useRef(onShort);
  report.current = onShort;
  useEffect(() => {
    if (s.ready) report.current?.(s.short ? s.text : null);
  }, [s.ready, s.short, s.text]);
  if (!s.tracked || (s.short && quiet)) return null;
  if (!s.short) return <p className="text-xs text-muted-foreground">{s.text}</p>;
  return (
    <p role="status" className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs font-medium">
      <PackageX className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span>
        {s.text}
        {after && <span className="font-normal text-muted-foreground"> {after}</span>}
      </span>
    </p>
  );
}
