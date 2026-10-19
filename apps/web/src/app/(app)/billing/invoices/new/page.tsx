'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import type { Paginated } from '@vcms/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LineEditor, TotalsBox, draftTotals, toPayload, useBillingCatalog, type DraftLine } from '@/components/billing/line-editor';
import { ClientPicker, type PickedClient } from '@/components/clients/client-picker';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { splitRef } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Charge, ClientDetail, Invoice } from '@/lib/types';
import { calcLine } from '@vcms/shared';

function Builder() {
  const router = useRouter();
  const search = useSearchParams();
  const { currency, can } = useSession();
  const cat = useBillingCatalog();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preset = search.get('clientId');
  const presetClient = useQuery({ queryKey: ['client', preset], queryFn: () => api.get<ClientDetail>(`/clients/${preset}`), enabled: !!preset && !client });
  useEffect(() => {
    if (presetClient.data && !client) setClient({ id: presetClient.data.id, displayName: presetClient.data.displayName });
  }, [presetClient.data, client]);

  const charges = useQuery({
    queryKey: ['charges', 'pending', client?.id],
    queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ clientId: client!.id, status: 'PENDING', pageSize: 200 })}`),
    enabled: !!client,
  });
  useEffect(() => setSelected(charges.data?.data.map((c) => c.id) ?? []), [charges.data]);

  const chargeTotals = useMemo(() => {
    const picked = (charges.data?.data ?? []).filter((c) => selected.includes(c.id));
    return picked.map((c) => ({ ...calcLine({ quantity: c.quantity, unitPriceMinor: c.unitPriceMinor, taxRateBasisPoints: c.taxRateBasisPoints }, cat.pricesIncludeTax), discountMinor: 0 }));
  }, [charges.data, selected, cat.pricesIncludeTax]);
  const manual = draftTotals(lines, currency, cat.pricesIncludeTax);
  const totals = chargeTotals.reduce((t, l) => ({ subtotalMinor: t.subtotalMinor + l.netMinor, taxMinor: t.taxMinor + l.taxMinor, totalMinor: t.totalMinor + l.grossMinor, discountMinor: t.discountMinor }), manual);

  // "pay": finish the invoice and open the payment window straight away (the client is usually at the desk).
  const save = useMutation({
    mutationFn: ({ issue }: { issue: boolean; pay?: boolean }) => api.post<Invoice>('/invoices', { clientId: client?.id, chargeIds: selected, lines: toPayload(lines, currency), notes: notes || null, issue }),
    onSuccess: (inv, v) => {
      toast.success(inv.status === 'DRAFT' ? 'Draft invoice saved' : `${inv.invoiceNo} finished`);
      router.push(`/billing/invoices/${inv.id}${v.pay ? '?pay=1' : ''}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const empty = !selected.length && !lines.length;
  return (
    <>
      <PageHeader title="New invoice" breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'New invoice' }]} description="Tick the client’s items that are not yet invoiced and add anything else. A draft can still be changed; a finished invoice cannot." />
      {error && <div className="mb-4"><FormError message={error} /></div>}
      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
            <Field label="Client" htmlFor="inv-client" required>
              <ClientPicker id="inv-client" value={client} onChange={(c) => { setClient(c); setSelected([]); }} />
            </Field>
          </CardContent>
        </Card>
        {client && (
          <Card>
            <CardHeader>
              <CardTitle>Not yet invoiced</CardTitle>
              {!!charges.data?.data.length && <span className="text-xs text-muted-foreground">{selected.length} of {charges.data.data.length} selected</span>}
            </CardHeader>
            {charges.isLoading ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">Loading…</p>
            ) : charges.data?.data.length ? (
              <ul className="divide-y border-t">
                {charges.data.data.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <Checkbox aria-label={`Include ${c.description}`} checked={selected.includes(c.id)} onCheckedChange={(v) => setSelected((s) => (v ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium">{splitRef(c.description)[0]}</p>
                      <p className="text-xs text-muted-foreground">{c.patient?.name ? `${c.patient.name} · ` : ''}{fmtDate(c.createdAt)} · {c.quantity} × {fmtMoney(c.unitPriceMinor, currency)}</p>
                    </div>
                    <span className="text-sm tabular">{fmtMoney(Math.round(c.quantity * c.unitPriceMinor), currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing is waiting to be invoiced for this client.</p>
            )}
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Other items</CardTitle></CardHeader>
          <CardContent>
            <LineEditor lines={lines} onChange={setLines} allowOverrides />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
            <Field label="Notes on invoice" htmlFor="inv-notes">
              <Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </Field>
            <TotalsBox {...totals} inclusive={cat.pricesIncludeTax} />
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-xs text-muted-foreground">A finished invoice can’t be changed; corrections are made with a credit note.</p>
          <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button variant="outline" disabled={!client || empty} loading={save.isPending && !save.variables?.issue} onClick={() => { setError(null); save.mutate({ issue: false }); }}>Save draft</Button>
          {can('payments.take') ? (
            <>
              <Button variant="outline" disabled={!client || empty} loading={save.isPending && !!save.variables?.issue && !save.variables.pay} onClick={() => { setError(null); save.mutate({ issue: true }); }}>Finish, pay later</Button>
              <Button disabled={!client || empty} loading={save.isPending && !!save.variables?.pay} onClick={() => { setError(null); save.mutate({ issue: true, pay: true }); }}><CreditCard /> Finish &amp; take payment</Button>
            </>
          ) : (
            <Button disabled={!client || empty} loading={save.isPending && !!save.variables?.issue} onClick={() => { setError(null); save.mutate({ issue: true }); }}>Finish invoice</Button>
          )}
        </div>
      </div>
    </>
  );
}

export default function NewInvoicePage() {
  return (
    <RequirePermission anyOf={['billing.write']}>
      <Suspense>
        <Builder />
      </Suspense>
    </RequirePermission>
  );
}
