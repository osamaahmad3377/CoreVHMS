'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_CATEGORIES, enumLabel, fromMinor } from '@vcms/shared';
import { Edit, Plus, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, bpToPct, parseMoney } from '@/components/billing/money';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Service, TaxRate } from '@/lib/types';

function ServiceDialog({ service, open, onOpenChange }: { service: Service | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates'), enabled: open });
  const [f, setF] = useState({ code: '', name: '', category: 'CONSULTATION', price: '', taxRateId: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setError(null); setF({ code: service?.code ?? '', name: service?.name ?? '', category: service?.category ?? 'CONSULTATION', price: service ? fromMinor(service.priceMinor, currency) : '', taxRateId: service?.taxRateId ?? '', isActive: service?.isActive ?? true }); }
  }, [open, service, currency]);
  const price = parseMoney(f.price, currency);
  const m = useMutation({
    mutationFn: () => { const body = { code: f.code, name: f.name, category: f.category, priceMinor: price, taxRateId: f.taxRateId || null, isActive: f.isActive }; return service ? api.patch(`/services/${service.id}`, body) : api.post('/services', body); },
    onSuccess: () => { toast.success('Service saved'); qc.invalidateQueries({ queryKey: ['services'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : 'New service'}</DialogTitle>
          <DialogDescription>Price changes apply to new charges only. Charges already captured and issued invoices keep their price.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" htmlFor="sv-code" required><Input id="sv-code" value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Category" htmlFor="sv-cat">
            <NativeSelect id="sv-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect>
          </Field>
          <Field label="Name" htmlFor="sv-name" required className="sm:col-span-2"><Input id="sv-name" value={f.name} maxLength={160} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Price" htmlFor="sv-price" required><MoneyInput id="sv-price" currency={currency} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Tax rate" htmlFor="sv-tax">
            <NativeSelect id="sv-tax" value={f.taxRateId} onChange={(e) => setF({ ...f, taxRateId: e.target.value })}>
              <option value="">Default</option>
              {(rates.data ?? []).filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name} ({bpToPct(r.rateBasisPoints)})</option>)}
            </NativeSelect>
          </Field>
        </div>
        {service && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.code.trim() || !f.name.trim() || price === null} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ServicesPage() {
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get<Service[]>('/services?all=true') });
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates') });
  const [dlg, setDlg] = useState<{ open: boolean; service: Service | null }>({ open: false, service: null });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <CardTitle>Services & fees</CardTitle>
          <Button size="sm" onClick={() => setDlg({ open: true, service: null })}><Plus /> New service</Button>
        </CardHeader>
        <DataTable
          query={q}
          rowKey={(s) => s.id}
          empty={<EmptyState icon={Tags} title="No services" description="Add consultation, procedure and other fees. Link services to appointment types to bill consultations automatically." />}
          columns={[
            { key: 'code', header: 'Code', cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
            { key: 'name', header: 'Service', cell: (s) => <span className="font-medium">{s.name}</span> },
            { key: 'cat', header: 'Category', cell: (s) => <span className="text-sm">{enumLabel(s.category)}</span> },
            { key: 'price', header: 'Price', className: 'text-right tabular', headerClassName: 'text-right', cell: (s) => fmtMoney(s.priceMinor, currency) },
            { key: 'tax', header: 'Tax', cell: (s) => <span className="text-xs">{rates.data?.find((r) => r.id === s.taxRateId)?.name ?? 'Default'}</span> },
            { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
            { key: 'act', header: '', className: 'text-right', cell: (s) => <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setDlg({ open: true, service: s })}><Edit /></Button> },
          ]}
        />
      </Card>
      <ServiceDialog service={dlg.service} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </RequirePermission>
  );
}
