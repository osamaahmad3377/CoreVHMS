'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { LineEditor, TotalsBox, draftTotals, toPayload, useBillingCatalog, type DraftLine } from '@/components/billing/line-editor';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { CommerceBadge } from '@/components/billing/status';
import { ClientPicker, type PickedClient } from '@/components/clients/client-picker';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ESTIMATE_STATUS_LABEL } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Estimate, Invoice } from '@/lib/types';

function EstimateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const cat = useBillingCatalog();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<Estimate>('/estimates', { clientId: client?.id, lines: toPayload(lines, currency), validUntil: validUntil || null, notes: notes || null }),
    onSuccess: (e) => { toast.success(`${e.estimateNo} created`); qc.invalidateQueries({ queryKey: ['estimates'] }); onOpenChange(false); setLines([]); setClient(null); },
    onError: (e: Error) => setError(e.message),
  });
  const totals = draftTotals(lines, currency, cat.pricesIncludeTax);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>New estimate</DialogTitle>
          <DialogDescription>A priced treatment plan for the client to agree to. Later it can be turned into an invoice.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" htmlFor="est-client" required><ClientPicker id="est-client" value={client} onChange={setClient} /></Field>
          <Field label="Valid until" htmlFor="est-valid"><Input id="est-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>
        <LineEditor lines={lines} onChange={setLines} allowOverrides />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notes" htmlFor="est-notes"><Textarea id="est-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
          <TotalsBox {...totals} inclusive={cat.pricesIncludeTax} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!client || !lines.length} onClick={() => { setError(null); m.mutate(); }}>Create estimate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Estimates() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const [create, setCreate] = useState(false);
  const query = useQuery({ queryKey: ['estimates'], queryFn: () => api.get<Estimate[]>('/estimates') });
  const act = useMutation({
    mutationFn: ({ id, status, convert }: { id: string; status?: string; convert?: boolean }) => (convert ? api.post<Invoice>(`/estimates/${id}/convert`) : api.post(`/estimates/${id}/status`, { status })),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['estimates'] });
      if (v.convert) router.push(`/billing/invoices/${(r as Invoice).id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader title="Estimates" description="Prices for planned treatment, given to the client before the work. When the client agrees, turn it into an invoice." actions={can('billing.write') && <Button size="sm" onClick={() => setCreate(true)}><Plus /> New estimate</Button>} />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={FileText} title="No estimates yet" description="Give clients a written quote before surgery or a longer treatment plan." />}
          columns={[
            { key: 'no', header: 'Estimate', cell: (r) => <span className="font-medium">{r.estimateNo}</span> },
            { key: 'client', header: 'Client', cell: (r) => <Link className="text-sm hover:underline" href={`/clients/${r.client.id}`}>{r.client.displayName}</Link> },
            { key: 'items', header: 'Items', cell: (r) => <span className="text-sm">{r.lines.map((l) => l.description).join(', ')}</span> },
            { key: 'date', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-sm">{fmtDate(r.createdAt)}{r.validUntil && <span className="block text-xs text-muted-foreground">valid to {fmtDate(r.validUntil)}</span>}</span> },
            { key: 'total', header: 'Total', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => fmtMoney(r.totalMinor, currency) },
            { key: 'st', header: 'Status', cell: (r) => <CommerceBadge status={r.status} labels={ESTIMATE_STATUS_LABEL} /> },
            {
              key: 'act',
              header: '',
              cell: (r) =>
                r.status === 'CONVERTED' ? (
                  r.convertedInvoiceId && <Button size="sm" variant="ghost" asChild><Link href={`/billing/invoices/${r.convertedInvoiceId}`}>Open invoice</Link></Button>
                ) : (
                  can('billing.write') && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="sm" variant="outline">Update</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {r.status === 'DRAFT' && <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, status: 'SENT' })}>Mark as given to client</DropdownMenuItem>}
                        <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, status: 'ACCEPTED' })}>Client agreed</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, status: 'DECLINED' })}>Client said no</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, convert: true })}>Turn into invoice (draft)</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                ),
            },
          ]}
        />
      </Card>
      <EstimateDialog open={create} onOpenChange={setCreate} />
    </>
  );
}

export default function EstimatesPage() {
  return (
    <RequirePermission anyOf={['billing.read']}>
      <Estimates />
    </RequirePermission>
  );
}
