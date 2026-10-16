'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PackageCheck, Send, XCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
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
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => api.post(`/purchase-orders/${id}/${action}`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-order', id] }); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const po = q.data;
  const ownOrder = po.createdById === session.user.id;
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{po.poNo} <CommerceBadge status={po.status} /></span>}
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Purchase orders', href: '/inventory/purchase-orders' }, { label: po.poNo }]}
        description={po.supplier.name}
        actions={
          <>
            {po.status === 'DRAFT' && can('procurement.write') && <Button size="sm" onClick={() => act.mutate({ action: 'submit' })}><Send /> Submit for approval</Button>}
            {po.status === 'SUBMITTED' && can('procurement.approve') && (
              <Button size="sm" disabled={ownOrder} title={ownOrder ? 'Orders must be approved by someone other than the person who raised them' : undefined} onClick={() => act.mutate({ action: 'approve' })}><CheckCircle2 /> Approve</Button>
            )}
            {['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && can('inventory.write') && <Button size="sm" onClick={() => setReceiving(true)}><PackageCheck /> Receive delivery</Button>}
            {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status) && (can('procurement.write') || can('procurement.approve')) && (
              <Button size="sm" variant="outline" onClick={async () => { const r = await confirm({ title: `Cancel ${po.poNo}?`, requireReason: true, destructive: true, confirmLabel: 'Cancel order' }); if (r.confirmed) act.mutate({ action: 'cancel', reason: r.reason }); }}><XCircle /> Cancel</Button>
            )}
          </>
        }
      />
      {po.status === 'SUBMITTED' && ownOrder && <p className="mb-3 text-sm text-muted-foreground">You raised this order, so another authorised person must approve it.</p>}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-4">
          <Card>
            <Table>
              <THead><TR><TH>Product</TH><TH className="text-right">Ordered</TH><TH className="text-right">Received</TH><TH className="text-right">Unit cost</TH><TH className="text-right">Line total</TH></TR></THead>
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
                    <p className="flex justify-between"><span className="font-medium">{r.receiptNo}</span><span className="tabular">{fmtMoney(r.totalMinor, currency)}</span></p>
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
                { label: 'Raised by', value: `${po.createdByName} · ${fmtDateTime(po.createdAt)}` },
                { label: 'Approved by', value: po.approvedByName ? `${po.approvedByName} · ${fmtDateTime(po.approvedAt)}` : null },
                { label: 'Expected delivery', value: fmtDate(po.expectedAt) },
                { label: 'Notes', value: po.notes },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <ReceiveStockDialog open={receiving} onOpenChange={setReceiving} order={po} />
    </>
  );
}

export default function PurchaseOrderPage() {
  return (
    <RequirePermission anyOf={['procurement.read']}>
      <OrderView />
    </RequirePermission>
  );
}
