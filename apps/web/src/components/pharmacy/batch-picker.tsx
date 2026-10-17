'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Field } from '../forms/field';
import { Input, NativeSelect } from '../ui/input';
import { api, qs } from '@/lib/api';
import { fmtDateOnly } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';

export interface BatchChoice {
  batchNumber: string;
  /** yyyy-MM-dd, or '' when unknown. */
  expiryDate: string;
}

interface AvailableBatches {
  product: { id: string; name: string; dispensingUnit: string; trackStock: boolean };
  location: { id: string; name: string } | null;
  batches: { id: string; batchNumber: string; expiryDate: string | null; onHand: number }[];
}

/**
 * Batch to issue: the batches on the shelf at this branch's stock location (first-expiring first, with
 * expiry and quantity on hand), defaulting to the one that expires first. Products whose stock is not
 * tracked get labelled free-text batch and expiry fields instead.
 */
export function BatchPicker({ id, productId, value, onChange, quantity }: { id: string; productId: string; value: BatchChoice; onChange: (v: BatchChoice) => void; quantity?: number }) {
  const { session } = useSession();
  const q = useQuery({
    queryKey: ['product-batches', productId, session.branch?.id],
    queryFn: () => api.get<AvailableBatches>(`/products/${productId}/batches${qs({ branchId: session.branch?.id })}`),
    staleTime: 30_000,
  });
  const batches = q.data?.batches ?? [];
  const tracked = !!q.data?.product.trackStock && !!q.data.location;
  const unit = q.data?.product.dispensingUnit ?? '';

  // Default to the first-expiring batch once, when the list arrives (not after the user changes it).
  const defaulted = useRef<string | null>(null);
  useEffect(() => {
    if (!q.data || defaulted.current === productId) return;
    defaulted.current = productId;
    const first = q.data.batches[0];
    if (tracked && first && !value.batchNumber) onChange({ batchNumber: first.batchNumber, expiryDate: first.expiryDate?.slice(0, 10) ?? '' });
  }, [q.data, productId, tracked, value.batchNumber, onChange]);

  if (q.isLoading) return <Field label="Batch" htmlFor={id}><NativeSelect id={id} disabled><option>Loading batches…</option></NativeSelect></Field>;

  if (!tracked) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Batch / lot" htmlFor={id} hint="Stock is not tracked for this product here — copy it from the pack.">
          <Input id={id} value={value.batchNumber} onChange={(e) => onChange({ ...value, batchNumber: e.target.value })} />
        </Field>
        <Field label="Batch expiry date" htmlFor={`${id}-exp`}>
          <Input id={`${id}-exp`} type="date" value={value.expiryDate} onChange={(e) => onChange({ ...value, expiryDate: e.target.value })} />
        </Field>
      </div>
    );
  }

  const chosen = batches.find((b) => b.batchNumber === value.batchNumber);
  const short = chosen && quantity && quantity > chosen.onHand;
  return (
    <Field
      label="Batch"
      htmlFor={id}
      hint={
        !batches.length
          ? `No usable stock of this product at ${q.data!.location!.name}.`
          : short
            ? `Only ${qtyUnit(chosen.onHand, unit)} left in this batch — the rest comes from the next batch to expire.`
            : !value.batchNumber
              ? 'The first-expiring batch is used if you leave this.'
              : `From ${q.data!.location!.name}.`
      }
    >
      <NativeSelect
        id={id}
        value={value.batchNumber}
        onChange={(e) => {
          const b = batches.find((x) => x.batchNumber === e.target.value);
          onChange({ batchNumber: e.target.value, expiryDate: b?.expiryDate?.slice(0, 10) ?? '' });
        }}
      >
        <option value="">Automatic — first-expiring batch</option>
        {batches.map((b, i) => (
          <option key={b.id} value={b.batchNumber}>
            {b.batchNumber} · {b.expiryDate ? `expires ${fmtDateOnly(b.expiryDate)}` : 'no expiry'} · {qtyUnit(b.onHand, unit)} on hand{i === 0 ? ' (expires first)' : ''}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
