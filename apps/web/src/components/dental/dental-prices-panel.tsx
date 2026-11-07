'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Smile } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDentalPrices } from './chart-sections';
import { FormError } from '../forms/form-error';
import { LoadingRows } from '../page';
import { Button } from '../ui/button';
import { NativeSelect } from '../ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { DentalPrice, Service } from '@/lib/types';
import { cn } from '@/lib/utils';

const scopeLabel = (p: DentalPrice) => (p.scope === 'mouth' ? 'Once per visit' : p.scope === 'tooth' ? 'Per tooth' : 'Per tooth or whole mouth');

/**
 * What each dental procedure is charged as, under the Dental appointment types: closed it shows how many procedures
 * have a price; open, one row per procedure with the service it is charged with. A procedure added on a dental chart
 * goes straight onto the client’s bill.
 */
export function DentalPricesPanel() {
  const { currency } = useSession();
  const qc = useQueryClient();
  const prices = useDentalPrices();
  const [open, setOpen] = useState(false);
  // Opened from a link to #dental-prices (e.g. the old Dental prices page): open and show it.
  useEffect(() => {
    const show = () => {
      if (window.location.hash !== '#dental-prices') return;
      setOpen(true);
      requestAnimationFrame(() => document.getElementById('dental-prices')?.scrollIntoView({ block: 'start' }));
    };
    show();
    window.addEventListener('hashchange', show);
    return () => window.removeEventListener('hashchange', show);
  }, []);
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
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

  const list = prices.data ?? [];
  const priced = list.filter((p) => p.service).length;
  const active = (services.data ?? []).filter((s) => s.isActive);
  // Dental services first, then everything else.
  const sorted = [...active.filter((s) => s.category === 'DENTAL'), ...active.filter((s) => s.category !== 'DENTAL')];
  const dirty = list.some((p) => (p.service?.id ?? '') !== (map[p.code] ?? ''));

  return (
    <div id="dental-prices" className="mt-2 scroll-mt-24 rounded-xl border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Smile className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Dental procedure prices</span>
          <span className="block text-xs text-muted-foreground">
            {prices.isLoading ? 'Loading…' : `${priced} of ${list.length} procedures have a price · charged when added on a dental chart`}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t">
          {error && <div className="p-3 pb-0"><FormError message={error} /></div>}
          {prices.isLoading || services.isLoading ? (
            <LoadingRows rows={5} />
          ) : (
            <ul className="divide-y" aria-label="Dental procedure prices">
              {list.map((p) => (
                <li key={p.code} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.abbr} · {scopeLabel(p)}
                      {p.dentitions ? ` · ${p.dentitions.map((d) => (d === 'EQUINE' ? 'horses' : d === 'CANINE' ? 'dogs' : 'cats')).join(', ')} only` : ''}
                    </span>
                  </span>
                  <NativeSelect aria-label={`Price for ${p.label}`} value={map[p.code] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [p.code]: e.target.value }))} className="h-9 w-full text-sm sm:w-72">
                    <option value="">Not charged</option>
                    {sorted.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmtMoney(s.priceMinor, currency)}</option>)}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <p className="text-xs text-muted-foreground">
              Prices come from <Link href="/settings/services" className="text-primary hover:underline">Services & prices</Link> (category Dental). The vet can still choose another service on the chart.
            </p>
            <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save prices</Button>
          </div>
        </div>
      )}
    </div>
  );
}
