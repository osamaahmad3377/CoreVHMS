'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bpToPct } from '@/components/billing/money';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { BillingSettings, TaxRate } from '@/lib/types';

function TaxDialog({ rate, open, onOpenChange }: { rate: TaxRate | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [pct, setPct] = useState('');
  const [isDefault, setDefault] = useState(false);
  const [isActive, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setName(rate?.name ?? ''); setPct(rate ? String(rate.rateBasisPoints / 100) : ''); setDefault(rate?.isDefault ?? false); setActive(rate?.isActive ?? true); setError(null); }
  }, [open, rate]);
  const bp = /^\d+(\.\d{1,2})?$/.test(pct.trim()) ? Math.round(Number(pct) * 100) : null;
  const m = useMutation({
    mutationFn: () => { const body = { name, rateBasisPoints: bp, isDefault, isActive }; return rate ? api.patch(`/tax-rates/${rate.id}`, body) : api.post('/tax-rates', body); },
    onSuccess: () => { toast.success('Tax rate saved'); qc.invalidateQueries({ queryKey: ['tax-rates'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{rate ? 'Edit tax rate' : 'Add tax rate'}</DialogTitle>
          <DialogDescription>Enter the rate your tax adviser has confirmed for your jurisdiction. Changing a rate affects new charges and invoices only; issued invoices keep their rates.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Name" htmlFor="tx-name" required hint="e.g. GST, Sales tax (Punjab), Exempt"><Input id="tx-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Rate (%)" htmlFor="tx-rate" required help="The tax percentage added to the price, for example 17 for 17%. Ask your accountant if you are not sure."><Input id="tx-rate" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={isDefault} onCheckedChange={(v) => setDefault(!!v)} /> Default rate for items without a specific rate</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={isActive} onCheckedChange={(v) => setActive(!!v)} /> Active</label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!name.trim() || bp === null || bp > 10000} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Options() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get<BillingSettings>('/billing/settings') });
  const [terms, setTerms] = useState('');
  useEffect(() => { if (q.data) setTerms(String(q.data.paymentTermsDays)); }, [q.data]);
  const m = useMutation({
    mutationFn: (patch: Partial<BillingSettings>) => api.patch<BillingSettings>('/billing/settings', patch),
    onSuccess: (d) => { qc.setQueryData(['billing-settings'], d); qc.invalidateQueries({ queryKey: ['po-approval-rule'] }); qc.invalidateQueries({ queryKey: ['purchase-order'] }); toast.success('Settings saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const toggle = (key: keyof BillingSettings, label: string, hint: string) => (
    <label className="flex items-start justify-between gap-4 py-3">
      <span className="text-sm">{label}<span className="block text-xs text-muted-foreground">{hint}</span></span>
      <Switch aria-label={label} checked={d[key] as boolean} disabled={m.isPending} onCheckedChange={(v) => m.mutate({ [key]: v })} />
    </label>
  );
  return (
    <Card>
      <CardHeader><div><CardTitle>Billing options</CardTitle><CardDescription>Currency: {d.currency}</CardDescription></div></CardHeader>
      <CardContent className="divide-y">
        {toggle('pricesIncludeTax', 'Prices include tax', 'Your prices already include sales tax. The invoice shows the tax part separately.')}
        {toggle('requireCashSession', 'Cash drawer must be open to take cash', 'Staff can take cash, refund or pay expenses only after opening the cash drawer for the day.')}
        {toggle('allowNegativeStock', 'Allow selling when stock shows zero', 'Turn on only while you are still entering your stock.')}
        {toggle('poRequiresSecondApprover', 'Purchase orders need a second person to approve', 'When on, the person who makes an order cannot approve it. When off, they can approve and send it in one step.')}
        <div className="flex items-end gap-2 py-3">
          <Field label="Days to pay" htmlFor="bs-terms" hint="How many days clients have to pay. 0 = pay straight away."><Input id="bs-terms" className="w-28" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
          <Button size="sm" variant="outline" disabled={!/^\d+$/.test(terms) || Number(terms) === d.paymentTermsDays} onClick={() => m.mutate({ paymentTermsDays: Number(terms) })}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BillingSettingsPage() {
  const rates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api.get<TaxRate[]>('/tax-rates') });
  const [dlg, setDlg] = useState<{ open: boolean; rate: TaxRate | null }>({ open: false, rate: null });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <Options />
        <Card>
          <CardHeader>
            <CardTitle>Tax rates</CardTitle>
            <Button size="sm" onClick={() => setDlg({ open: true, rate: null })}><Plus /> Add tax rate</Button>
          </CardHeader>
          <DataTable
            query={rates}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No tax rates" description="Without a tax rate, invoices carry no tax. Add the rates that apply to your practice." />}
            columns={[
              { key: 'name', header: 'Name', cell: (r) => <span className="flex items-center gap-2 font-medium">{r.name}{r.isDefault && <Badge>Default</Badge>}</span> },
              { key: 'rate', header: 'Rate', cell: (r) => bpToPct(r.rateBasisPoints) },
              { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
              { key: 'act', header: '', className: 'text-right', cell: (r) => <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setDlg({ open: true, rate: r })}><Edit /></Button> },
            ]}
          />
        </Card>
      </div>
      <TaxDialog rate={dlg.rate} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </RequirePermission>
  );
}
