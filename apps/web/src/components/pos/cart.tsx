'use client';
import { fromMinor } from '@vcms/shared';
import { Minus, Pencil, Plus, ShoppingCart, Trash2, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { MoneyInput, bpToPct, parseMoney } from '../billing/money';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { blockReason, lineAmounts, type CartLine } from './model';
import { fmtMoney } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import { cn } from '@/lib/utils';

function LineEditPopover({ line, currency, onSave }: { line: CartLine; currency: string; onSave: (patch: Partial<CartLine>) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [pct, setPct] = useState('');
  const gross = Math.round(line.quantity * (parseMoney(price, currency) ?? line.priceMinor));
  const discountMinor = pct ? Math.round((gross * Number(pct)) / 100) : (parseMoney(discount, currency) ?? 0);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setPrice(fromMinor(line.priceMinor, currency)); setDiscount(line.discountMinor ? fromMinor(line.discountMinor, currency) : ''); setPct(''); }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit price or discount for ${line.item.name}`}><Pencil /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="grid w-80 gap-3">
        <p className="text-sm font-medium">{line.item.name}</p>
        <label className="grid gap-1 text-xs text-muted-foreground">Unit price<MoneyInput currency={currency} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">Discount<MoneyInput currency={currency} value={pct ? fromMinor(discountMinor, currency) : discount} disabled={!!pct} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">or %<input inputMode="decimal" aria-label="Discount percent" className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        </div>
        {line.item.priceMinor !== null && parseMoney(price, currency) !== line.item.priceMinor && <p className="text-2xs text-muted-foreground">Catalogue price {fmtMoney(line.item.priceMinor, currency)}. The change is recorded on the invoice.</p>}
        <Button
          size="sm"
          disabled={parseMoney(price, currency) === null || discountMinor < 0 || discountMinor > gross || Number(pct) > 100}
          onClick={() => { onSave({ priceMinor: parseMoney(price, currency)!, discountMinor }); setOpen(false); }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function PosCart({
  lines,
  onChange,
  client,
  onClient,
  totals,
  inclusive,
  allowOverrides,
  allowNegative,
  currency,
  onCharge,
  onHold,
  onClear,
  onOtherItem,
}: {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  client: PickedClient | null;
  onClient: (c: PickedClient | null) => void;
  totals: { subtotalMinor: number; taxMinor: number; totalMinor: number; discountMinor: number };
  inclusive: boolean;
  allowOverrides: boolean;
  allowNegative: boolean;
  currency: string;
  onCharge: () => void;
  onHold: () => void;
  onClear: () => void;
  /** Opens "+ Other item" (an item typed in by name and price); only for staff allowed to set prices. */
  onOtherItem?: () => void;
}) {
  const [pickingClient, setPickingClient] = useState(false);
  const setQty = (key: string, quantity: number) => onChange(quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
  const items = lines.reduce((n, l) => n + l.quantity, 0);
  const stockProblem = lines.find((l) => l.item.trackStock && !allowNegative && l.item.available !== null && l.quantity > l.item.available);
  return (
    <div className="flex h-full min-h-[480px] flex-col rounded-lg border bg-card shadow-sm">
      <div className="border-b p-3">
        {client && !pickingClient ? (
          <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2">
            <UserRound className="h-4 w-4 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{client.displayName}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove client" onClick={() => onClient(null)}><X /></Button>
          </div>
        ) : pickingClient ? (
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><ClientPicker defaultOpen value={client} onChange={(c) => { onClient(c); setPickingClient(false); }} /></div>
            <Button variant="ghost" size="icon" aria-label="Cancel" onClick={() => setPickingClient(false)}><X /></Button>
          </div>
        ) : (
          <button type="button" onClick={() => setPickingClient(true)} className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
            <UserRound className="h-4 w-4" /> Walk-in customer <span className="ml-auto text-xs text-primary">Add client</span>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length ? (
          <ul className="divide-y" aria-label="Basket">
            {lines.map((l) => {
              const a = lineAmounts(l, inclusive);
              const atLimit = !!blockReason(l.item, l.quantity, allowNegative) && !l.item.rxOnly;
              // Medicine already handed out against a prescription: fixed quantity and price, only removable.
              const fixed = l.item.type === 'CHARGE';
              return (
                <li key={l.key} className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.item.name}</p>
                      <p className="text-xs text-muted-foreground tabular">
                        {fmtMoney(l.priceMinor, currency)}{l.item.type === 'PRODUCT' && ` / ${l.item.unit}`}{fixed && <span> × {l.quantity} · handed out on a prescription</span>}
                        {l.priceMinor !== l.item.priceMinor && <span className="text-warning"> (price changed)</span>}
                        {!!l.discountMinor && <span className="text-success"> · −{fmtMoney(l.discountMinor, currency)}</span>}
                        <span> · tax {bpToPct(l.item.taxRateBasisPoints)}</span>
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular">{fmtMoney(a.grossMinor, currency)}</p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    {!fixed && (
                    <div className="flex items-center rounded-md border">
                      <Button variant="ghost" size="icon-sm" aria-label={`Decrease ${l.item.name}`} onClick={() => setQty(l.key, l.quantity - 1)}><Minus /></Button>
                      <input
                        aria-label={`Quantity of ${l.item.name}`}
                        inputMode="decimal"
                        className="h-7 w-12 bg-transparent text-center text-sm tabular outline-none"
                        value={l.quantity}
                        onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setQty(l.key, v); }}
                      />
                      <Button variant="ghost" size="icon-sm" aria-label={`Increase ${l.item.name}`} disabled={atLimit} onClick={() => setQty(l.key, l.quantity + 1)}><Plus /></Button>
                    </div>
                    )}
                    {l.item.trackStock && l.item.available !== null && <span className={cn('text-2xs', l.quantity > l.item.available ? 'font-medium text-destructive' : 'text-muted-foreground')}>{qtyUnit(l.item.available - l.quantity, l.item.unit)} left</span>}
                    <span className="ml-auto flex">
                      {allowOverrides && !fixed && <LineEditPopover line={l} currency={currency} onSave={(patch) => onChange(lines.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))} />}
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.item.name}`} title={fixed ? 'Takes it out of this sale; it stays under Not yet invoiced' : undefined} onClick={() => setQty(l.key, 0)}><Trash2 /></Button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <ShoppingCart className="h-8 w-8 opacity-40" />
            <p className="text-sm">Scan or tap items to start a sale</p>
          </div>
        )}
      </div>

      <div className="border-t bg-muted/30 p-3">
        {onOtherItem && (
          <Button type="button" variant="outline" size="sm" className="mb-2 w-full border-dashed" onClick={onOtherItem}><Plus /> Other item</Button>
        )}
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><dt>{items} item{items === 1 ? '' : 's'} · subtotal (excl. tax)</dt><dd className="tabular">{fmtMoney(totals.subtotalMinor, currency)}</dd></div>
          {!!totals.discountMinor && <div className="flex justify-between text-success"><dt>Discounts</dt><dd className="tabular">−{fmtMoney(totals.discountMinor, currency)}</dd></div>}
          <div className="flex justify-between text-muted-foreground"><dt>Tax{inclusive ? ' (included)' : ''}</dt><dd className="tabular">{fmtMoney(totals.taxMinor, currency)}</dd></div>
          <div className="mt-1 flex items-baseline justify-between border-t pt-2"><dt className="text-base font-semibold">Total</dt><dd className="text-2xl font-bold tabular tracking-tight">{fmtMoney(totals.totalMinor, currency)}</dd></div>
        </dl>
        {stockProblem && <p className="mt-2 text-xs text-destructive" role="alert">Only {qtyUnit(stockProblem.item.available ?? 0, stockProblem.item.unit)} of {stockProblem.item.name} in stock.</p>}
        <div className="mt-3 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-2">
          <Button variant="outline" disabled={!lines.length} onClick={onHold}>Pause sale</Button>
          <Button variant="outline" disabled={!lines.length && !client} onClick={onClear}>Clear</Button>
          <Button size="lg" className="h-12 min-w-0 px-3 text-base" disabled={!lines.length || totals.totalMinor <= 0 || !!stockProblem} onClick={onCharge}>
            Take payment {fmtMoney(totals.totalMinor, currency)} <span className="hidden rounded bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-2xs xl:inline">F9</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
