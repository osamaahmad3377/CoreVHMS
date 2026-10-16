'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CommerceBadge } from '@/components/billing/status';
import { useConfirm } from '@/components/confirm';
import { ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { StockCount } from '@/lib/types';

function CountSheet() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency } = useSession();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['stock-count', id], queryFn: () => api.get<StockCount>(`/stock/counts/${id}`) });
  useEffect(() => {
    if (q.data?.lines) setCounted(Object.fromEntries(q.data.lines.map((l) => [l.id, l.countedQty?.toString() ?? ''])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.patch(`/stock/counts/${id}`, { lines: Object.entries(counted).filter(([, v]) => v !== '').map(([lineId, v]) => ({ lineId, countedQty: Number(v) })) }),
    onSuccess: () => { toast.success('Counts saved'); qc.invalidateQueries({ queryKey: ['stock-count', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const complete = useMutation({
    mutationFn: async () => { if (Object.values(counted).some((v) => v !== '')) await save.mutateAsync(); return api.post<{ adjusted: number }>(`/stock/counts/${id}/complete`); },
    onSuccess: (r) => { toast.success(`Count completed · ${r.adjusted} adjustment(s) posted`); ['stock-count', 'stock-counts', 'stock', 'stock-movements'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const editable = c.status === 'OPEN' && can('inventory.adjust');
  const lines = c.lines ?? [];
  const varianceValue = lines.reduce((n, l) => (counted[l.id] === '' || counted[l.id] === undefined ? n : n + (Number(counted[l.id]) - l.expectedQty) * l.batch.unitCostMinor), 0);
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{c.countNo} · {c.location.name} <CommerceBadge status={c.status} /></span>}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Stock counts', href: '/inventory/counts' }, { label: c.countNo ?? '' }]}
        description={`Started by ${c.startedByName}. Expected quantities are a snapshot at the start; variances are posted against the live balance when you complete.`}
        actions={
          editable && (
            <>
              <Button size="sm" variant="outline" disabled={!Object.values(counted).some((v) => v !== '')} loading={save.isPending && !complete.isPending} onClick={() => save.mutate()}>Save progress</Button>
              <Button size="sm" loading={complete.isPending} disabled={lines.some((l) => (counted[l.id] ?? '') === '')} onClick={async () => (await confirm({ title: 'Complete this count?', description: `Variances will be posted as count adjustments (value ${fmtMoney(Math.round(varianceValue), currency)} at cost). This cannot be undone.`, confirmLabel: 'Complete count' })).confirmed && complete.mutate()}>Complete count</Button>
            </>
          )
        }
      />
      <Card>
        <Table>
          <THead><TR><TH>Product</TH><TH>Batch</TH><TH>Expiry</TH><TH className="text-right">Expected</TH><TH className="w-32 text-right">Counted</TH><TH className="text-right">Variance</TH></TR></THead>
          <TBody>
            {lines.map((l) => {
              const v = counted[l.id] === '' || counted[l.id] === undefined ? null : Number(counted[l.id]) - l.expectedQty;
              return (
                <TR key={l.id}>
                  <TD className="text-sm">{l.product.name}</TD>
                  <TD className="text-sm">{l.batch.batchNumber}</TD>
                  <TD className="text-sm">{fmtDate(l.batch.expiryDate)}</TD>
                  <TD className="text-right tabular">{l.expectedQty} <span className="text-xs text-muted-foreground">{l.product.dispensingUnit}</span></TD>
                  <TD className="text-right">{editable ? <Input aria-label={`Counted ${l.product.name} ${l.batch.batchNumber}`} className="text-right" inputMode="decimal" value={counted[l.id] ?? ''} onChange={(e) => setCounted((s) => ({ ...s, [l.id]: e.target.value }))} /> : <span className="tabular">{l.countedQty ?? '—'}</span>}</TD>
                  <TD className={`text-right tabular ${v ? 'font-medium text-destructive' : ''}`}>{v === null ? '—' : v > 0 ? `+${v}` : v}</TD>
                </TR>
              );
            })}
            {!lines.length && <TR><TD colSpan={6} className="py-8 text-center text-sm text-muted-foreground">This location had no stock when the count started.</TD></TR>}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

export default function CountPage() {
  return (
    <RequirePermission anyOf={['inventory.read']}>
      <CountSheet />
    </RequirePermission>
  );
}
