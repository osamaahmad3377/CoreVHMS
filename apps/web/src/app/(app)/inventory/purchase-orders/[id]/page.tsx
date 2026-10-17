'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PackageCheck, Printer, Send, XCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { CommerceBadge } from '@/components/billing/status';
import { useConfirm } from '@/components/confirm';
import { ReceiveStockDialog } from '@/components/inventory/receive-dialog';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { PurchaseOrder } from '@/lib/types';

function OrderView() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can, currency, session } = useSession();
  const [receiving, setReceiving] = useState(false);
  const q = useQuery({ queryKey: ['purchase-order', id], queryFn: () => api.get<PurchaseOrder>(`/purchase-orders/${id}`) });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => api.post(`/purchase-orders/${id}/${action}`, { reason }),
    onSuccess: (_d, v) => {
      ['purchase-order', 'purchase-orders', 'stock', 'reorder-suggestions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const done: Record<string, string> = { submit: 'Sent for approval', approve: 'Order approved — print it or send it to the supplier', cancel: 'Order cancelled' };
      if (done[v.action]) toast.success(done[v.action]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const po = q.data;
  const secondApprover = po.needsSecondApprover !== false;
  const ownOrder = secondApprover && po.createdById === session.user.id;
  const deliverTo = po.location ? `${po.location.name}${po.location.branch ? ` · ${po.location.branch.name}` : ''}` : null;
  return (
    <>
      <div className="print:hidden">
      <PageHeader
        title={<span className="flex items-center gap-2">{po.poNo} <CommerceBadge status={po.status} /></span>}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Orders', href: '/inventory/purchase-orders' }, { label: po.poNo }]}
        description={po.supplier.name}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
            {po.status === 'DRAFT' && !secondApprover && can('procurement.approve') ? (
              <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: 'approve' })}><CheckCircle2 /> Approve &amp; send</Button>
            ) : (
              po.status === 'DRAFT' && can('procurement.write') && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: 'submit' })}><Send /> Send for approval</Button>
            )}
            {po.status === 'SUBMITTED' && can('procurement.approve') && (
              <Button size="sm" disabled={ownOrder} title={ownOrder ? 'Orders must be approved by someone other than the person who raised them' : undefined} onClick={() => act.mutate({ action: 'approve' })}><CheckCircle2 /> Approve</Button>
            )}
            {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && can('inventory.write') && <Button size="sm" onClick={() => setReceiving(true)}><PackageCheck /> Receive delivery</Button>}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status) && (can('procurement.write') || can('procurement.approve')) && (
              <Button size="sm" variant="outline" onClick={async () => { const r = await confirm({ title: `Cancel ${po.poNo}?`, requireReason: true, destructive: true, confirmLabel: 'Cancel order', cancelLabel: 'Keep order' }); if (r.confirmed) act.mutate({ action: 'cancel', reason: r.reason }); }}><XCircle /> Cancel order</Button>
            )}
          </>
        }
      />
      {po.status === 'SUBMITTED' && ownOrder && <p className="mb-3 text-sm text-muted-foreground">You raised this order, so another person must approve it. (An owner can change this in Settings → Tax &amp; payments.)</p>}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-4">
          <Card>
            <Table>
              <THead><TR><TH>Product</TH><TH className="text-right">Ordered</TH><TH className="text-right">Received</TH><TH className="text-right">Cost price (each)</TH><TH className="text-right">Line total</TH></TR></THead>
              <TBody>
                {po.lines.map((l) => (
                  <TR key={l.id}>
                    <TD className="text-sm">{l.product.name}</TD>
                    <TD className="text-right tabular">{l.quantity} <span className="text-xs text-muted-foreground">{l.product.dispensingUnit}</span></TD>
                    <TD className={`text-right tabular ${l.quantityReceived >= l.quantity ? 'text-success' : ''}`}>{l.quantityReceived}</TD>
                    <TD className="text-right tabular">{fmtMoney(l.unitCostMinor, currency)}</TD>
                    <TD className="text-right tabular">{fmtMoney(Math.round(l.quantity * l.unitCostMinor), currency)}</TD>
                  </TR>
                ))}
                <TR><TD colSpan={4} className="text-right font-medium">Total</TD><TD className="text-right font-semibold tabular">{fmtMoney(po.totalMinor, currency)}</TD></TR>
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader><CardTitle>Deliveries</CardTitle></CardHeader>
            {po.receipts?.length ? (
              <ul className="divide-y border-t">
                {po.receipts.map((r) => (
                  <li key={r.id} className="px-4 py-2 text-sm">
                    <p className="flex justify-between"><span className="font-medium">Delivery <span className="text-xs font-normal text-muted-foreground">{r.receiptNo}</span></span><span className="tabular">{fmtMoney(r.totalMinor, currency)}</span></p>
                    <p className="text-xs text-muted-foreground">{fmtDateTime(r.receivedAt)} · {r.receivedByName} · {r.lines.map((l) => `${l.product.name} ${l.quantity} (batch ${l.batch.batchNumber}, exp ${fmtDate(l.batch.expiryDate)})`).join('; ')}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing received yet.</p>}
          </Card>
        </div>
        <Card>
          <CardContent className="pt-4">
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: 'Supplier', value: <>{po.supplier.name}{po.supplier.phone && <span className="block text-xs text-muted-foreground">{po.supplier.phone}</span>}</> },
                { label: 'Deliver to', value: deliverTo },
                { label: 'Raised by', value: `${po.createdByName} · ${fmtDateTime(po.createdAt)}` },
                { label: 'Approved by', value: po.approvedByName ? `${po.approvedByName} · ${fmtDateTime(po.approvedAt)}` : null },
                { label: 'Expected delivery', value: fmtDate(po.expectedAt) },
                { label: 'Notes', value: po.notes },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      </div>
      <PurchaseOrderDocument po={po} clinic={org.data ?? null} currency={currency} deliverTo={deliverTo} />
      <ReceiveStockDialog open={receiving} onOpenChange={setReceiving} order={po} />
    </>
  );
}

/** The order as sent to the supplier (printed or saved as PDF from the browser). */
function PurchaseOrderDocument({ po, clinic, currency, deliverTo }: { po: PurchaseOrder; clinic: ClinicHeader | null; currency: string; deliverTo: string | null }) {
  const b = po.location?.branch;
  return (
    <article className="hidden bg-white p-8 text-[10.5pt] text-black print:block">
      <header className="flex justify-between gap-6 border-b border-black pb-4">
        <div>
          <p className="text-lg font-bold">{clinic?.legalName || clinic?.name}</p>
          <p>{[clinic?.addressLine1, clinic?.addressLine2, clinic?.city, clinic?.postcode].filter(Boolean).join(', ')}</p>
          <p>{[clinic?.phone, clinic?.email].filter(Boolean).join(' · ')}</p>
          {clinic?.taxNumber && <p>Tax number: {clinic.taxNumber}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{po.status === 'DRAFT' ? 'DRAFT PURCHASE ORDER' : 'PURCHASE ORDER'}</p>
          <p>{po.poNo}</p>
          <p>Date: {fmtDate(po.approvedAt ?? po.createdAt)}</p>
          {po.expectedAt && <p>Delivery by: {fmtDate(po.expectedAt)}</p>}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-6 py-4">
        <div>
          <p className="text-xs uppercase">Supplier</p>
          <p className="font-semibold">{po.supplier.name}</p>
          {po.supplier.contactName && <p>Attn: {po.supplier.contactName}</p>}
          {po.supplier.address && <p>{po.supplier.address}</p>}
          <p>{[po.supplier.phone, po.supplier.email].filter(Boolean).join(' · ')}</p>
        </div>
        <div>
          <p className="text-xs uppercase">Deliver to</p>
          <p className="font-semibold">{deliverTo ?? '—'}</p>
          {b && <p>{[b.addressLine1, b.addressLine2, b.city].filter(Boolean).join(', ')}</p>}
          {b?.phone && <p>{b.phone}</p>}
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left"><th className="py-1">#</th><th className="py-1">Item</th><th className="py-1">Code</th><th className="py-1 text-right">Quantity</th><th className="py-1 text-right">Unit cost</th><th className="py-1 text-right">Amount</th></tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-neutral-300">
              <td className="py-1">{i + 1}</td>
              <td className="py-1">{l.product.name}</td>
              <td className="py-1">{l.product.sku ?? ''}</td>
              <td className="py-1 text-right">{l.quantity} {l.product.dispensingUnit}</td>
              <td className="py-1 text-right">{fmtMoney(l.unitCostMinor, currency)}</td>
              <td className="py-1 text-right">{fmtMoney(Math.round(l.quantity * l.unitCostMinor), currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5} className="pt-2 text-right font-semibold">Order total</td><td className="pt-2 text-right font-bold">{fmtMoney(po.totalMinor, currency)}</td></tr></tfoot>
      </table>
      {po.notes && <p className="mt-4"><b>Notes:</b> {po.notes}</p>}
      <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
        <div><p>Raised by: {po.createdByName}</p></div>
        <div><p>Approved by: {po.approvedByName ?? '________________________'}</p><p className="mt-8 border-t border-black pt-1">Signature</p></div>
      </footer>
      <p className="mt-6 text-xs">Please quote {po.poNo} on your delivery note and invoice.</p>
    </article>
  );
}

export default function PurchaseOrderPage() {
  return (
    <RequirePermission anyOf={['procurement.read']}>
      <OrderView />
    </RequirePermission>
  );
}
