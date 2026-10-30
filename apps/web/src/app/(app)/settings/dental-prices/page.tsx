'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDentalPrices } from '@/components/dental/chart-sections';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalPrice, Service } from '@/lib/types';

function Form() {
  const { currency } = useSession();
  const qc = useQueryClient();
  const prices = useDentalPrices();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services') });
  const [map, setMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (prices.data) setMap(Object.fromEntries(prices.data.map((p) => [p.code, p.service?.id ?? ''])));
  }, [prices.data]);
  const save = useMutation({
    mutationFn: () => api.put<DentalPrice[]>('/dental/prices', { items: Object.entries(map).map(([code, serviceId]) => ({ code, serviceId: serviceId || null })) }),
    onSuccess: (p) => {
      qc.setQueryData(['dental-prices'], p);
      toast.success('Dental prices saved');
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });
  if (prices.isLoading || services.isLoading) return <LoadingRows rows={6} />;
  const active = (services.data ?? []).filter((s) => s.isActive);
  // Dental services first, then everything else.
  const sorted = [...active.filter((s) => s.category === 'DENTAL'), ...active.filter((s) => s.category !== 'DENTAL')];
  const dirty = (prices.data ?? []).some((p) => (p.service?.id ?? '') !== (map[p.code] ?? ''));
  return (
    <Card>
      {error && <div className="p-4 pb-0"><FormError message={error} /></div>}
      <Table>
        <THead>
          <TR>
            <TH>Procedure</TH>
            <TH className="hidden sm:table-cell">Recorded</TH>
            <TH>Charged with</TH>
          </TR>
        </THead>
        <TBody>
          {(prices.data ?? []).map((p) => (
            <TR key={p.code}>
              <TD>
                <p className="font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.abbr}{p.dentitions ? ` · ${p.dentitions.map((d) => (d === 'EQUINE' ? 'horses' : d.toLowerCase())).join(', ')} only` : ''}</p>
              </TD>
              <TD className="hidden text-sm text-muted-foreground sm:table-cell">{p.scope === 'mouth' ? 'Once per visit' : p.scope === 'tooth' ? 'Per tooth' : 'Per tooth or whole mouth'}</TD>
              <TD>
                <NativeSelect aria-label={`Price for ${p.label}`} value={map[p.code] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [p.code]: e.target.value }))} className="min-w-[14rem]">
                  <option value="">Not charged</option>
                  {sorted.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtMoney(s.priceMinor, currency)}</option>)}
                </NativeSelect>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
        <p className="text-xs text-muted-foreground">
          Prices come from{' '}
          <Link href="/settings/services" className="text-primary hover:underline">Services & prices</Link>
          {' '}(for example “Scale and polish” or “Surgical extraction”, category Dental). The vet can still choose another service on the chart.
        </p>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
      </div>
    </Card>
  );
}

export default function DentalPricesPage() {
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">Dental prices</h2>
          <p className="text-sm text-muted-foreground">What each dental procedure is charged as. A procedure added on a dental chart goes straight onto the client’s bill.</p>
        </div>
        <Form />
      </div>
    </RequirePermission>
  );
}
