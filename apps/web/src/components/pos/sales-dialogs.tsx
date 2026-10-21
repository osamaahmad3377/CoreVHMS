'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { Clock, Printer, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ClinicHeader } from '../billing/invoice-document';
import { CommerceBadge } from '../billing/status';
import { EmptyState, LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { receiptFromInvoice } from '../receipts/receipt-document';
import { ReceiptPreview } from '../receipts/use-receipt';
import type { CartLine, SaleDiscount } from './model';
import type { PickedClient } from '../clients/client-picker';
import { api } from '@/lib/api';
import { fmtMoney, fmtRelative, fmtTime } from '@/lib/format';
import type { Invoice } from '@/lib/types';

export interface HeldSale {
  id: string;
  at: string;
  client: PickedClient | null;
  lines: CartLine[];
  saleDiscount?: SaleDiscount | null;
}

/** Today's counter sales at this branch, with receipt reprint. */
export function TodaySalesDialog({ open, onOpenChange, clinic, currency, onReprint }: { open: boolean; onOpenChange: (o: boolean) => void; clinic: ClinicHeader | null; currency: string; onReprint: (invoice: Invoice) => void }) {
  const [selected, setSelected] = useState<Invoice | null>(null);
  const q = useQuery({ queryKey: ['pos', 'recent'], queryFn: () => api.get<Invoice[]>('/pos/recent'), enabled: open });
  const rows = q.data ?? [];
  const total = rows.filter((r) => r.status !== 'VOID').reduce((n, r) => n + r.totalMinor, 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelected(null); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Today’s sales</DialogTitle>
          <DialogDescription>{rows.length} counter sale{rows.length === 1 ? '' : 's'} at this branch today · {fmtMoney(total, currency)} not counting cancelled sales</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            {q.isLoading ? <LoadingRows rows={4} /> : !rows.length ? <EmptyState title="No counter sales yet today" /> : (
              <ul className="divide-y">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelected(r)} className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60 ${selected?.id === r.id ? 'bg-primary/5' : ''}`}>
                      <span className="w-12 text-xs text-muted-foreground tabular">{fmtTime(r.issuedAt)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{r.invoiceNo} <span className="font-normal text-muted-foreground">· {r.client?.displayName ?? 'Walk-in'}</span></span>
                        <span className="block truncate text-xs text-muted-foreground">{r.lines.map((l) => l.description).join(', ')}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular">{fmtMoney(r.totalMinor, r.currency)}</span>
                        <span className="block text-2xs text-muted-foreground">{[...new Set(r.allocations.map((a) => enumLabel(a.payment.method)))].join(' + ') || 'Not paid'}</span>
                      </span>
                      <CommerceBadge status={r.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg surface-flat p-3">
            {selected ? (
              <div className="grid gap-3">
                <div className="max-h-[48vh] overflow-y-auto rounded border bg-muted/40 p-2">
                  <ReceiptPreview data={receiptFromInvoice(selected, selected.allocations.map((a) => ({ method: a.payment.method, amountMinor: a.amountMinor, receiptNo: a.payment.receiptNo })))} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => onReprint(selected)}><Printer /> Reprint</Button>
                  <Button size="sm" variant="outline" asChild><Link href={`/billing/invoices/${selected.id}`}>Invoice</Link></Button>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">Select a sale to view or reprint its receipt.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HeldSalesDialog({ open, onOpenChange, held, currency, onRecall, onDelete, totalOf }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  held: HeldSale[];
  currency: string;
  onRecall: (h: HeldSale) => void;
  onDelete: (id: string) => void;
  totalOf: (lines: CartLine[], saleDiscount?: SaleDiscount | null) => number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Paused sales</DialogTitle>
          <DialogDescription>Paused baskets are kept on this computer only. Prices and stock are checked again when you finish the sale.</DialogDescription>
        </DialogHeader>
        {held.length ? (
          <ul className="divide-y rounded-md border">
            {held.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{h.client?.displayName ?? 'Walk-in'} · {fmtMoney(totalOf(h.lines, h.saleDiscount), currency)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{fmtRelative(h.at)} · {h.lines.map((l) => `${l.quantity}× ${l.item.name}`).join(', ')}</span>
                </span>
                <Button size="sm" onClick={() => onRecall(h)}><RotateCcw /> Resume</Button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete paused sale" onClick={() => onDelete(h.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No paused sales" />
        )}
      </DialogContent>
    </Dialog>
  );
}
