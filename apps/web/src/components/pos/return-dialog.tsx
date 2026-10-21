'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Minus, Plus, Search, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { LoadingRows } from '../page';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Sale {
  id: string;
  invoiceNo: string;
  issuedAt: string;
  totalMinor: number;
  paidMinor: number;
  client: { id: string; displayName: string } | null;
  lines: { id: string; description: string; quantity: number; returnedQuantity: number; grossMinor: number; returnedMinor: number; returnable: boolean }[];
}

interface Outcome {
  creditNoteNo: string;
  creditedMinor: number;
  refundedMinor: number;
  keptAsCreditMinor: number;
  restocked: { description: string; quantity: number }[];
  invoiceNo: string;
}

const REASONS = ['Wrong item', 'Damaged or faulty', 'Changed their mind', 'Not needed'];

/** What returning `qty` of a line is worth (tax included); the last part takes exactly what is left of the price. */
const worth = (l: Sale['lines'][number], qty: number) => {
  const left = l.quantity - l.returnedQuantity;
  const rest = l.grossMinor - l.returnedMinor;
  return Math.abs(left - qty) < 1e-9 ? rest : Math.min(rest, Math.round((l.grossMinor * qty) / l.quantity));
};

/**
 * Items brought back to the counter: find the sale, choose what comes back, say why, and choose how the money
 * goes back. One step records the credit note, puts the items back on the shelf and pays the refund.
 */
export function ReturnItemsDialog({ open, onOpenChange, currency }: { open: boolean; onOpenChange: (o: boolean) => void; currency: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 250);
  const [sale, setSale] = useState<Sale | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState<'ORIGINAL' | 'CASH' | 'CREDIT'>('ORIGINAL');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);
  useEffect(() => {
    if (open) {
      setSearch('');
      setSale(null);
      setQty({});
      setReason('');
      setRefundTo('ORIGINAL');
      setError(null);
      setDone(null);
    }
  }, [open]);
  const sales = useQuery({ queryKey: ['pos', 'sales', q], queryFn: () => api.get<Sale[]>(`/pos/sales${qs({ q: q || undefined })}`), enabled: open && !sale && !done });

  const chosen = sale ? sale.lines.filter((l) => (qty[l.id] ?? 0) > 0) : [];
  const amount = chosen.reduce((n, l) => n + worth(l, qty[l.id]), 0);
  // The part that is simply less to pay comes off what is still owed; the rest is money going back.
  const owed = sale ? sale.totalMinor - sale.paidMinor : 0;
  const moneyBack = sale ? Math.max(0, Math.min(amount - owed, sale.paidMinor)) : 0;
  const m = useMutation({
    mutationFn: () => api.post<Outcome>('/pos/returns', { invoiceId: sale!.id, lines: chosen.map((l) => ({ lineId: l.id, quantity: qty[l.id] })), reason, refundTo }),
    onSuccess: (r) => {
      setDone(r);
      ['pos', 'invoices', 'payments', 'stock', 'cash', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`${r.creditNoteNo} recorded`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return items</DialogTitle>
          <DialogDescription>{done ? 'The return is recorded.' : sale ? `Choose what ${sale.client?.displayName ?? 'the customer'} is bringing back.` : 'Find the sale: type the receipt (invoice) number or the client’s name.'}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="grid gap-3 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-lg font-semibold">{done.creditNoteNo} · {fmtMoney(done.creditedMinor, currency)}</p>
            <ul className="mx-auto grid gap-1 text-sm text-muted-foreground">
              {done.refundedMinor > 0 && <li><strong className="text-foreground">Give back {fmtMoney(done.refundedMinor, currency)}</strong> to the customer.</li>}
              {done.keptAsCreditMinor > 0 && <li>{fmtMoney(done.keptAsCreditMinor, currency)} kept as credit on the client’s account.</li>}
              {done.refundedMinor === 0 && done.keptAsCreditMinor === 0 && <li>Nothing to hand back: it comes off what was still owed.</li>}
              {done.restocked.map((r) => <li key={r.description}>{r.quantity} × {r.description} back on the shelf.</li>)}
            </ul>
          </div>
        ) : !sale ? (
          <div className="grid gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus aria-label="Find the sale" className="pl-9" placeholder="Receipt number (e.g. INV-000123) or client name" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {sales.isLoading ? (
              <LoadingRows rows={3} />
            ) : (sales.data ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No counter sale found in the last 60 days.</p>
            ) : (
              <ul className="grid gap-1.5">
                {(sales.data ?? []).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSale(s)} className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{s.invoiceNo} · {fmtMoney(s.totalMinor, currency)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{fmtDateTime(s.issuedAt)} · {s.client?.displayName ?? 'Walk-in customer'} · {s.lines.map((l) => l.description).join(', ')}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {error && <FormError message={error} />}
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{sale.invoiceNo}</span>
              <span className="text-muted-foreground">· {fmtDateTime(sale.issuedAt)} · {sale.client?.displayName ?? 'Walk-in customer'}</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setSale(null); setQty({}); setError(null); }}>Choose another sale</Button>
            </div>
            <ul className="divide-y rounded-lg border">
              {sale.lines.map((l) => {
                const left = l.quantity - l.returnedQuantity;
                const n = qty[l.id] ?? 0;
                return (
                  <li key={l.id} className={cn('flex items-center gap-3 px-3 py-2.5', !l.returnable && 'opacity-60')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {l.returnable ? `Bought ${l.quantity}${l.returnedQuantity ? ` · ${l.returnedQuantity} already returned` : ''}` : left <= 1e-9 ? 'Already returned' : 'Handed out on a prescription: return it through the pharmacy'}
                      </span>
                    </span>
                    {l.returnable && (
                      <span className="flex items-center rounded-md border">
                        <Button variant="ghost" size="icon-sm" aria-label={`Fewer ${l.description}`} disabled={n <= 0} onClick={() => setQty((x) => ({ ...x, [l.id]: Math.max(0, n - 1) }))}><Minus /></Button>
                        <span className="w-9 text-center text-sm tabular" aria-label={`Quantity of ${l.description} to return`}>{n}</span>
                        <Button variant="ghost" size="icon-sm" aria-label={`More ${l.description}`} disabled={n + 1 > left + 1e-9} onClick={() => setQty((x) => ({ ...x, [l.id]: Math.min(left, n + 1) }))}><Plus /></Button>
                      </span>
                    )}
                    <span className="w-24 text-right text-sm tabular text-muted-foreground">{n > 0 ? fmtMoney(worth(l, n), currency) : ''}</span>
                  </li>
                );
              })}
            </ul>
            <Field label="Why is it coming back?" htmlFor="rt-reason" required>
              <Input id="rt-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong size" />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary/50 hover:bg-primary/5">{r}</button>
              ))}
            </div>
            {moneyBack > 0 && (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-sm font-medium">The money goes back…</legend>
                {([['ORIGINAL', 'The way it was paid'], ['CASH', 'In cash from the drawer'], ...(sale.client ? [['CREDIT', 'Kept as credit on the client’s account']] : [])] as [typeof refundTo, string][]).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="rt-refund" checked={refundTo === k} onChange={() => setRefundTo(k)} /> {label}
                  </label>
                ))}
              </fieldset>
            )}
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              Credit for the returned items: <strong className="tabular">{fmtMoney(amount, currency)}</strong>
              {moneyBack > 0 ? <> · money back <strong className="tabular">{fmtMoney(moneyBack, currency)}</strong></> : amount > 0 ? ' · comes off what is still owed' : ''}
            </p>
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {sale && (
                <Button loading={m.isPending} disabled={amount <= 0 || !reason.trim()} onClick={() => { setError(null); m.mutate(); }}>
                  <Undo2 /> Return items
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
