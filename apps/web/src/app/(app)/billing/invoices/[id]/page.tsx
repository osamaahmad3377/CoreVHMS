'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, fromMinor } from '@vcms/shared';
import { Ban, CreditCard, FileMinus, Printer, ReceiptText, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { InvoiceDocument, type ClinicHeader } from '@/components/billing/invoice-document';
import { LineEditor, toPayload, type DraftLine } from '@/components/billing/line-editor';
import { MoneyInput, bpToPct, parseMoney } from '@/components/billing/money';
import { CommerceBadge } from '@/components/billing/status';
import { TakePaymentDialog } from '@/components/billing/take-payment-dialog';
import { useConfirm } from '@/components/confirm';
import { receiptFromInvoice } from '@/components/receipts/receipt-document';
import { useReceiptPrinter } from '@/components/receipts/use-receipt';
import { splitRef } from '@/lib/labels';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Invoice } from '@/lib/types';

/** Payment line on a printed receipt, including the card slip / transfer number when one was given. */
const toReceiptPayment = (a: Invoice['allocations'][number]) => ({
  method: a.payment.method,
  amountMinor: a.amountMinor,
  receiptNo: a.payment.receiptNo,
  reference: (a.payment as { reference?: string | null }).reference ?? null,
});

function CreditNoteDialog({ invoice, open, onOpenChange }: { invoice: Invoice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const max = invoice.totalMinor - invoice.creditedMinor;
  useEffect(() => {
    if (open) { setAmount(fromMinor(Math.min(max, invoice.balanceMinor || max), invoice.currency)); setReason(''); setError(null); }
  }, [open, max, invoice]);
  const minor = parseMoney(amount, invoice.currency);
  const m = useMutation({
    mutationFn: () => api.post(`/invoices/${invoice.id}/credit-notes`, { amountMinor: minor, reason }),
    onSuccess: () => {
      toast.success('Credit note issued');
      ['invoice', 'invoices', 'client', 'statement'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Credit note for {invoice.invoiceNo}</DialogTitle>
          <DialogDescription>Reduces what the client owes. If the invoice is already paid, this amount becomes credit for the client, to refund or use later.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Amount (tax inclusive)" htmlFor="cn-amount" required hint={`Up to ${fmtMoney(max, invoice.currency)}`}>
          <MoneyInput id="cn-amount" currency={invoice.currency} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="cn-reason" required>
          <Textarea id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!minor || minor <= 0 || minor > max || !reason.trim()} onClick={() => { setError(null); m.mutate(); }}>Issue credit note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftEditor({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const m = useMutation({
    mutationFn: (body: object) => api.patch<Invoice>(`/invoices/${invoice.id}`, body),
    onSuccess: () => { setLines([]); qc.invalidateQueries({ queryKey: ['invoice', invoice.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Add items to draft</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <LineEditor lines={lines} onChange={setLines} allowOverrides />
        {!!lines.length && <div><Button size="sm" loading={m.isPending} onClick={() => m.mutate({ lines: toPayload(lines, currency) })}>Add to invoice</Button></div>}
      </CardContent>
    </Card>
  );
}

function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const receipts = useReceiptPrinter();
  const [printing, setPrinting] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/invoices/${id}`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const refresh = () => ['invoice', 'invoices', 'client', 'statement', 'charges', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: object; method?: 'del' | 'patch' }) => (method === 'del' ? api.del(path) : method === 'patch' ? api.patch(path, body) : api.post(path, body)),
    onSuccess: (_d, v) => {
      if (v.method === 'del') { toast.success('Draft discarded; its items are back in “Not yet invoiced”'); router.push('/billing'); return; }
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const i = q.data;
  const open = i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID';
  const cur = i.currency;
  /** Prints a small receipt showing the given payments (all of them, or the payments up to one row). */
  const printReceipt = async (key: string, allocations: Invoice['allocations'], invoice: Invoice = i) => {
    setPrinting(key);
    try {
      await receipts.print(receiptFromInvoice(invoice, allocations.map(toReceiptPayment)));
    } finally {
      setPrinting(null);
    }
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={<span className="flex items-center gap-2">{i.invoiceNo} <CommerceBadge status={i.status} overdue={i.overdue} /></span>}
          breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: i.invoiceNo }]}
          description={<>{i.client ? <Link className="hover:underline" href={`/clients/${i.client.id}`}>{i.client.displayName}</Link> : 'Counter sale'}{i.patient && <> · <Link className="hover:underline" href={`/patients/${i.patient.id}`}>{i.patient.name}</Link></>}</>}
          actions={
            <>
              {i.status === 'DRAFT' && can('billing.write') && (
                <>
                  <Button size="sm" variant="outline" onClick={async () => (await confirm({ title: 'Discard this draft?', description: 'Its items go back to “Not yet invoiced”.', destructive: true, confirmLabel: 'Discard' })).confirmed && act.mutate({ path: `/invoices/${i.id}`, method: 'del' })}><Trash2 /> Discard</Button>
                  <Button size="sm" loading={act.isPending} title="After this it can't be changed; corrections are made with a credit note" onClick={async () => (await confirm({ title: 'Finish this invoice?', description: "It gets an invoice number. After this it can't be changed; corrections are made with a credit note.", confirmLabel: 'Finish invoice', cancelLabel: 'Keep editing' })).confirmed && act.mutate({ path: `/invoices/${i.id}/issue` })}><Send /> Finish invoice</Button>
                </>
              )}
              {open && can('payments.take') && <Button size="sm" onClick={() => setPaying(true)}><CreditCard /> Take payment</Button>}
              {i.status !== 'DRAFT' && i.status !== 'VOID' && can('billing.refund') && i.totalMinor > i.creditedMinor && <Button size="sm" variant="outline" onClick={() => setCrediting(true)}><FileMinus /> Credit note</Button>}
              {i.status !== 'DRAFT' && i.status !== 'VOID' && can('billing.void') && !i.creditNotes.length && (
                <Button size="sm" variant="outline" onClick={async () => {
                  const r = await confirm({ title: `Cancel ${i.invoiceNo}?`, description: 'Money paid on this invoice becomes credit for the client, its items go back to “Not yet invoiced” and shop-sale stock is returned. The invoice number is kept for the record.', destructive: true, requireReason: true, confirmLabel: 'Cancel invoice', cancelLabel: 'Keep invoice' });
                  if (r.confirmed) act.mutate({ path: `/invoices/${i.id}/void`, body: { reason: r.reason } });
                }}><Ban /> Cancel invoice</Button>
              )}
              {i.status !== 'DRAFT' && can('payments.take') && (
                <Button size="sm" variant="outline" loading={printing === 'all'} title="Print on the receipt printer (80 mm / 58 mm roll)" onClick={() => printReceipt('all', i.allocations)}><ReceiptText /> Print receipt (small)</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print invoice (A4)</Button>
            </>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="grid gap-4">
            <Card>
              <Table>
                <THead>
                  <TR><TH>Item</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit</TH><TH className="text-right">Discount</TH><TH className="text-right">Tax</TH><TH className="text-right">Amount</TH>{i.status === 'DRAFT' && <TH />}</TR>
                </THead>
                <TBody>
                  {i.lines.map((l) => (
                    <TR key={l.id}>
                      <TD><p className="text-sm">{splitRef(l.description)[0]}</p><p className="text-2xs text-muted-foreground">{enumLabel(l.kind)}{splitRef(l.description)[1] && ` · ${splitRef(l.description)[1]}`}</p></TD>
                      <TD className="text-right tabular">{l.quantity}</TD>
                      <TD className="text-right tabular">{fmtMoney(l.unitPriceMinor, cur)}</TD>
                      <TD className="text-right tabular">{l.discountMinor ? fmtMoney(l.discountMinor, cur) : '—'}</TD>
                      <TD className="text-right tabular text-xs">{bpToPct(l.taxRateBasisPoints)} · {fmtMoney(l.taxMinor, cur)}</TD>
                      <TD className="text-right font-medium tabular">{fmtMoney(l.grossMinor, cur)}</TD>
                      {i.status === 'DRAFT' && (
                        <TD><Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.description}`} onClick={() => act.mutate({ path: `/invoices/${i.id}`, method: 'patch', body: { removeLineIds: [l.id] } })}><Trash2 /></Button></TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
              <div className="border-t p-4">
                <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal (excl. tax)</dt><dd className="tabular">{fmtMoney(i.subtotalMinor, cur)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Tax{i.pricesIncludeTax ? ' (included)' : ''}</dt><dd className="tabular">{fmtMoney(i.taxMinor, cur)}</dd></div>
                  <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular">{fmtMoney(i.totalMinor, cur)}</dd></div>
                  {!!i.creditedMinor && <div className="flex justify-between text-muted-foreground"><dt>Credited</dt><dd className="tabular">−{fmtMoney(i.creditedMinor, cur)}</dd></div>}
                  {!!i.paidMinor && <div className="flex justify-between text-muted-foreground"><dt>Paid</dt><dd className="tabular">−{fmtMoney(i.paidMinor, cur)}</dd></div>}
                  {i.status !== 'DRAFT' && i.status !== 'VOID' && <div className="flex justify-between font-semibold"><dt>Amount owed</dt><dd className="tabular">{fmtMoney(i.balanceMinor, cur)}</dd></div>}
                </dl>
              </div>
            </Card>
            {i.status === 'DRAFT' && can('billing.write') && <DraftEditor invoice={i} />}
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardContent className="pt-4">
                <DescriptionList
                  className="sm:grid-cols-1"
                  items={[
                    { label: 'Finished', value: i.issuedAt ? `${fmtDateTime(i.issuedAt)} by ${i.issuedByName}` : 'Not finished yet (draft)' },
                    { label: 'Due', value: fmtDate(i.dueAt) },
                    { label: 'Created by', value: i.createdByName },
                    ...(i.status === 'VOID' ? [{ label: 'Cancelled', value: `${fmtDateTime(i.voidedAt)} by ${i.voidedByName}: ${i.voidReason}` }] : []),
                    ...(i.notes ? [{ label: 'Notes', value: <span className="whitespace-pre-wrap">{i.notes}</span> }] : []),
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
              {i.allocations.length ? (
                <ul className="divide-y border-t">
                  {i.allocations.map((a, idx) => (
                    <li key={a.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className="min-w-0 flex-1"><Link className="font-medium hover:underline" href={`/billing/payments?highlight=${a.payment.id}`}>{a.payment.receiptNo}</Link><span className="block text-xs text-muted-foreground">{enumLabel(a.payment.method)} · {fmtDate(a.payment.receivedAt)}</span></span>
                      <span className="tabular">{fmtMoney(a.amountMinor, cur)}</span>
                      {can('payments.take') && (
                        <Button size="icon-sm" variant="ghost" loading={printing === a.id} aria-label={`Print receipt ${a.payment.receiptNo}`} title="Print receipt" onClick={() => printReceipt(a.id, i.allocations.slice(0, idx + 1))}><Printer /></Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="px-4 pb-4 text-sm text-muted-foreground">No payments yet.</p>}
            </Card>
            {!!i.creditNotes.length && (
              <Card>
                <CardHeader><CardTitle>Credit notes</CardTitle></CardHeader>
                <ul className="divide-y border-t">
                  {i.creditNotes.map((c) => (
                    <li key={c.id} className="px-4 py-2 text-sm">
                      <p className="flex justify-between"><span className="font-medium">{c.creditNoteNo}</span><span className="tabular">{fmtMoney(c.amountMinor, cur)}</span></p>
                      <p className="text-xs text-muted-foreground">{c.reason} · {fmtDate(c.createdAt)} · {c.createdByName}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>
      <div className="hidden print:block"><InvoiceDocument invoice={i} clinic={org.data ?? null} /></div>
      <TakePaymentDialog
        open={paying}
        onOpenChange={setPaying}
        clientId={i.clientId}
        invoice={i}
        silent
        onPaid={(payments, { changeMinor }) => {
          // Offer the receipt straight away; each payment row also keeps its own "Print receipt" button.
          const nos = payments.map((p) => p.receiptNo).join(', ');
          toast.success(payments.length === 1 ? `Payment ${nos} recorded` : `${payments.length} payments recorded (${nos})`, {
            description: changeMinor ? `Give ${fmtMoney(changeMinor, cur)} change` : undefined,
            action: {
              label: 'Print receipt',
              onClick: async () => {
                const fresh = await q.refetch();
                if (fresh.data) await printReceipt('all', fresh.data.allocations, fresh.data);
              },
            },
          });
        }}
      />
      <CreditNoteDialog invoice={i} open={crediting} onOpenChange={setCrediting} />
    </>
  );
}

export default function InvoicePage() {
  return (
    <RequirePermission anyOf={['billing.read']}>
      <InvoiceView />
    </RequirePermission>
  );
}
