'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_CATEGORIES, enumLabel, fromMinor } from '@vcms/shared';
import { Check, Edit, Plus, Search, Tags } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, bpToPct, parseMoney } from '@/components/billing/money';
import { codeFromName } from '@/components/billing/service-code';
import { DeleteRecordButton } from '@/components/delete-record';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Service, TaxRate } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The service as the API wants it back (every field), with some of it changed. */
const bodyOf = (s: Service, change: Partial<Pick<Service, 'priceMinor' | 'isActive'>> = {}) => ({ code: s.code, name: s.name, category: s.category, priceMinor: s.priceMinor, taxRateId: s.taxRateId, isActive: s.isActive, ...change });

function ServiceDialog({ service, open, onOpenChange, codes }: { service: Service | null; open: boolean; onOpenChange: (o: boolean) => void; codes: string[] }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates'), enabled: open });
  const [f, setF] = useState({ code: '', name: '', category: 'CONSULTATION', price: '', taxRateId: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setF({ code: service?.code ?? '', name: service?.name ?? '', category: service?.category ?? 'CONSULTATION', price: service ? fromMinor(service.priceMinor, currency) : '', taxRateId: service?.taxRateId ?? '', isActive: service?.isActive ?? true });
    }
  }, [open, service, currency]);
  const price = parseMoney(f.price, currency);
  // A new service gets its code from its name unless one is typed.
  const code = f.code.trim() || codeFromName(f.name, codes);
  const m = useMutation({
    mutationFn: () => {
      const body = { code, name: f.name.trim(), category: f.category, priceMinor: price, taxRateId: f.taxRateId || null, isActive: f.isActive };
      return service ? api.patch(`/services/${service.id}`, body) : api.post('/services', body);
    },
    onSuccess: () => {
      toast.success(`${f.name.trim()} saved`);
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : 'Add a service'}</DialogTitle>
          <DialogDescription>Something you charge for. A new price applies to new charges; invoices already issued keep theirs.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="sv-name" required className="sm:col-span-2">
            <Input id="sv-name" value={f.name} maxLength={160} autoFocus={!service} placeholder="e.g. Nail trim" onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Price" htmlFor="sv-price" required error={f.price.trim() && price === null ? 'Enter a valid amount' : undefined}>
            <MoneyInput id="sv-price" currency={currency} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label="Group" htmlFor="sv-cat" hint="Where it is listed, and how reports group it">
            <NativeSelect id="sv-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Tax" htmlFor="sv-tax">
            <NativeSelect id="sv-tax" value={f.taxRateId} onChange={(e) => setF({ ...f, taxRateId: e.target.value })}>
              <option value="">The clinic’s usual rate</option>
              {(rates.data ?? []).filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name} ({bpToPct(r.rateBasisPoints)})</option>)}
            </NativeSelect>
          </Field>
          <Field label="Short code" htmlFor="sv-code" hint={service ? 'Shown on reports' : `Optional — made from the name: ${code}`}>
            <Input id="sv-code" value={f.code} maxLength={30} placeholder={service ? undefined : code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        {service && (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="font-medium">Offered</span>
              <span className="block text-xs text-muted-foreground">Switched off: hidden when billing and booking, history kept.</span>
            </span>
            <Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} aria-label="Offered" />
          </label>
        )}
        <DialogFooter>
          {service && <DeleteRecordButton className="text-destructive hover:text-destructive sm:mr-auto" name={service.name} path={`/services/${service.id}`} invalidate={[['services'], ['appointment-types']]} onDeleted={() => onOpenChange(false)} />}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || price === null} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The price, typed straight into the list: Enter or leaving the box saves it. */
function PriceCell({ service }: { service: Service }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [value, setValue] = useState(() => fromMinor(service.priceMinor, currency));
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(fromMinor(service.priceMinor, currency)), [service.priceMinor, currency]);
  const parsed = parseMoney(value, currency);
  const m = useMutation({
    mutationFn: (priceMinor: number) => api.patch<Service>(`/services/${service.id}`, bodyOf(service, { priceMinor })),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setValue(fromMinor(service.priceMinor, currency));
    },
  });
  const commit = () => {
    if (parsed === null) return setValue(fromMinor(service.priceMinor, currency));
    if (parsed !== service.priceMinor) m.mutate(parsed);
  };
  return (
    <div className="flex items-center justify-end gap-2">
      {service.priceMinor === 0 && !m.isPending && <span className="hidden text-xs font-medium text-warning sm:inline">Set a price</span>}
      <MoneyInput
        aria-label={`Price of ${service.name}`}
        currency={currency}
        className={cn('h-9 w-36 text-right tabular', parsed === null && 'border-destructive', service.priceMinor === 0 && 'border-warning/60')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(fromMinor(service.priceMinor, currency));
            e.currentTarget.blur();
          }
        }}
      />
      <span className="w-4">{saved && <Check className="h-4 w-4 text-success" aria-label="Saved" />}</span>
    </div>
  );
}

function OnOffCell({ service }: { service: Service }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (isActive: boolean) => api.patch<Service>(`/services/${service.id}`, bodyOf(service, { isActive })),
    onSuccess: (_s, isActive) => {
      toast.success(`${service.name} ${isActive ? 'switched on' : 'switched off'}`);
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return <Switch checked={service.isActive} disabled={m.isPending} onCheckedChange={(v) => m.mutate(v)} aria-label={`${service.name} offered`} />;
}

type Filter = 'all' | 'unpriced' | 'off';

export default function ServicesPage() {
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get<Service[]>('/services?all=true') });
  const [dlg, setDlg] = useState<{ open: boolean; service: Service | null }>({ open: false, service: null });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const all = useMemo(() => q.data ?? [], [q.data]);
  const counts = { all: all.filter((s) => s.isActive).length, unpriced: all.filter((s) => s.isActive && s.priceMinor === 0).length, off: all.filter((s) => !s.isActive).length };
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(
      (s) =>
        (filter === 'off' ? !s.isActive : s.isActive) &&
        (filter !== 'unpriced' || s.priceMinor === 0) &&
        (!term || s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term) || enumLabel(s.category).toLowerCase().includes(term)),
    );
  }, [all, search, filter]);
  const groups = SERVICE_CATEGORIES.map((c) => ({ category: c, rows: shown.filter((s) => s.category === c) })).filter((g) => g.rows.length);
  const chip = (k: Filter, label: string, n: number) => (
    <button
      key={k}
      type="button"
      role="tab"
      aria-selected={filter === k}
      onClick={() => setFilter(k)}
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium transition-colors', filter === k ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted')}
    >
      {label} <span className={cn('rounded-pill px-1.5 text-xs tabular', k === 'unpriced' && n ? 'bg-warning/20 text-foreground' : 'bg-foreground/[0.06]')}>{n}</span>
    </button>
  );

  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Services & prices</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Everything you charge for. Type a price and press Enter — it is saved straight away.</p>
          </div>
          <Button size="sm" onClick={() => setDlg({ open: true, service: null })}><Plus /> Add service</Button>
        </CardHeader>
        <div className="flex flex-col gap-2 border-b px-4 pb-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search services" className="h-9 pl-9" placeholder="Search a service…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5 sm:ml-auto" role="tablist" aria-label="Show">
            {chip('all', 'All', counts.all)}
            {chip('unpriced', 'Needs a price', counts.unpriced)}
            {chip('off', 'Switched off', counts.off)}
          </div>
        </div>
        {q.isLoading ? (
          <LoadingRows rows={6} />
        ) : !groups.length ? (
          <EmptyState
            icon={Tags}
            title={all.length ? 'Nothing matches' : 'No services yet'}
            description={all.length ? (filter === 'unpriced' ? 'Every service has a price.' : 'Try another word, or clear the search.') : 'Add what you charge for — consultations, procedures, grooming… Link them to appointment types to bill visits automatically.'}
          />
        ) : (
          <div className="grid gap-5 p-4">
            {groups.map((g) => (
              <section key={g.category} aria-label={enumLabel(g.category)}>
                <h3 className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {enumLabel(g.category)} <span className="font-normal normal-case tracking-normal">· {g.rows.length}</span>
                </h3>
                <ul className="divide-y rounded-xl border">
                  {g.rows.map((s) => (
                    <li key={s.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5', !s.isActive && 'bg-muted/40')}>
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-sm font-medium', !s.isActive && 'text-muted-foreground')}>{s.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {s.code}
                          {!!s.appointmentTypes?.length && ` · charged for ${s.appointmentTypes.map((t) => t.name).join(', ')}`}
                        </p>
                      </div>
                      <PriceCell service={s} />
                      <OnOffCell service={s} />
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setDlg({ open: true, service: s })}><Edit /></Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      <ServiceDialog service={dlg.service} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} codes={all.map((s) => s.code)} />
    </RequirePermission>
  );
}
