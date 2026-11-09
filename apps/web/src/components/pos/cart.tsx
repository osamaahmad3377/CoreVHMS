'use client';
import { fromMinor } from '@vcms/shared';
import { POS_BILL_SECTIONS } from '@vcms/shared';
import { ChevronDown, Clock, FileText, Minus, Pencil, Percent, Plus, Search, ShoppingCart, Stethoscope, Trash2, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { MoneyInput, bpToPct, parseMoney } from '../billing/money';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { PatientPicker } from '../patients/patient-picker';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { blockReason, lineAmounts, lineSection, type CartLine, type CounterWaiting, type RxReference, type SaleDiscount } from './model';
import { fmtMoney } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import { cn } from '@/lib/utils';

function LineEditPopover({ line, currency, onSave, discountOnly }: { line: CartLine; currency: string; onSave: (patch: Partial<CartLine>) => void; /** Waiting charges: the price is fixed; only a discount can be given. */ discountOnly?: boolean }) {
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
        <Button variant="ghost" size="icon-sm" aria-label={discountOnly ? `Discount on ${line.item.name}` : `Edit price or discount for ${line.item.name}`}>{discountOnly ? <Percent /> : <Pencil />}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="grid w-80 gap-3">
        <p className="text-sm font-medium">{line.item.name}</p>
        {!discountOnly && <label className="grid gap-1 text-xs text-muted-foreground">Unit price<MoneyInput currency={currency} value={price} onChange={(e) => setPrice(e.target.value)} /></label>}
        <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">Discount<MoneyInput currency={currency} value={pct ? fromMinor(discountMinor, currency) : discount} disabled={!!pct} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">or %<input inputMode="decimal" aria-label="Discount percent" className="h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        </div>
        {line.item.priceMinor !== null && parseMoney(price, currency) !== line.item.priceMinor && <p className="text-2xs text-muted-foreground">Catalogue price {fmtMoney(line.item.priceMinor, currency)}. The change is recorded on the invoice.</p>}
        <Button
          size="sm"
          disabled={parseMoney(price, currency) === null || discountMinor < 0 || discountMinor > gross || Number(pct) > 100}
          onClick={() => { onSave({ priceMinor: parseMoney(price, currency)!, discountMinor: Math.max(discountMinor, line.item.baseDiscountMinor ?? 0) }); setOpen(false); }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The vet's prescription, read at the counter: what was prescribed and how to give it. A reference only — the cashier
 * adds the medicines the client wants from the shop's stock ("Find in shop"), or leaves them out.
 */
function PrescriptionPanel({ prescriptions, onFind }: { prescriptions: RxReference[]; onFind?: (name: string) => void }) {
  const [open, setOpen] = useState(true);
  const count = prescriptions.reduce((n, r) => n + r.items.length, 0);
  return (
    <section className="border-b bg-primary/[0.03]" aria-labelledby="rx-ref-h">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <FileText className="h-4 w-4 text-primary" />
        <span id="rx-ref-h" className="text-sm font-semibold">Doctor’s prescription</span>
        <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular text-primary">{count}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">read only</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid max-h-64 gap-2 overflow-y-auto px-3 pb-3">
          {prescriptions.map((r) => (
            <div key={r.id} className="rounded-lg border bg-background">
              <p className="flex flex-wrap items-center gap-x-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">{r.prescriptionNo}</span>
                {r.patient && <span>for {r.patient.name}</span>}
                {r.prescriber && <span>· {r.prescriber}</span>}
                {r.authorizedAt && <span>· {new Date(r.authorizedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
              </p>
              <ul className="divide-y" aria-label={`Prescription ${r.prescriptionNo}`}>
                {r.items.map((i) => (
                  <li key={i.id} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{i.instructions}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Quantity: {qtyUnit(i.quantity, i.unit)}
                        {i.repeats > 0 ? ` · ${i.repeats} repeat${i.repeats === 1 ? '' : 's'}` : ''}
                        {i.handedOut > 0 ? ` · ${qtyUnit(i.handedOut, i.unit)} already handed out` : ''}
                      </p>
                    </div>
                    {onFind && (
                      <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => onFind(i.name.split(/\s+/).slice(0, 2).join(' '))} aria-label={`Find ${i.name} in the shop`}>
                        <Search className="h-3.5 w-3.5" /> Find in shop
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {r.notes && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">{r.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** "Discount" on the whole sale: a percentage or a fixed amount, spread over the items. */
function SaleDiscountPopover({ currency, onApply }: { currency: string; onApply: (d: SaleDiscount) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'PCT' | 'AMT'>('PCT');
  const [value, setValue] = useState('');
  const amount = mode === 'PCT' ? Number(value) : (parseMoney(value, currency) ?? 0);
  const valid = amount > 0 && (mode !== 'PCT' || amount <= 100);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setValue(''); setMode('PCT'); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"><Percent /> Discount</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3">
        <p className="text-sm font-medium">Discount on the whole sale</p>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1" role="radiogroup" aria-label="Discount kind">
          {([['PCT', 'Percent (%)'], ['AMT', 'Amount']] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setValue(''); }} className={cn('rounded px-2 py-1 text-xs font-medium', mode === k ? 'bg-card shadow-sm' : 'text-muted-foreground')}>{label}</button>
          ))}
        </div>
        {mode === 'PCT' ? (
          <input autoFocus inputMode="decimal" aria-label="Discount percent" placeholder="e.g. 10" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm" />
        ) : (
          <MoneyInput autoFocus currency={currency} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <Button size="sm" disabled={!valid} onClick={() => { onApply({ mode, value: mode === 'PCT' ? amount : amount }); setOpen(false); }}>Apply discount</Button>
      </PopoverContent>
    </Popover>
  );
}

export function PosCart({
  lines,
  onChange,
  saleDiscount,
  onSaleDiscount,
  saleDiscountMinor,
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
  waiting = [],
  onPickWaiting,
  prescriptions = [],
  onFindInShop,
}: {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  saleDiscount: SaleDiscount | null;
  onSaleDiscount: (d: SaleDiscount | null) => void;
  /** How much the whole-sale discount takes off. */
  saleDiscountMinor: number;
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
  /** Clients ready to pay (today's finished visits and prescriptions), shown while the sale is empty. */
  waiting?: CounterWaiting[];
  onPickWaiting?: (w: CounterWaiting) => void;
  /** The client's recent prescriptions, read at the counter. */
  prescriptions?: RxReference[];
  /** Puts a medicine's name in the shop search. */
  onFindInShop?: (name: string) => void;
}) {
  const [pickingClient, setPickingClient] = useState(false);
  // The pet the client was found by (shown beside the client's name).
  const [forPet, setForPet] = useState<{ clientId: string; name: string } | null>(null);
  const setQty = (key: string, quantity: number) => onChange(quantity <= 0 ? lines.filter((l) => l.key !== key) : lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
  const items = lines.reduce((n, l) => n + l.quantity, 0);
  const stockProblem = lines.find((l) => l.item.trackStock && !allowNegative && l.item.available !== null && l.quantity > l.item.available);
  return (
    <div className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShoppingCart className="h-4 w-4 text-primary" /> Current sale
        </h2>
        {lines.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular text-muted-foreground">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>}
      </div>
      <div className="border-b p-3 pt-2.5">
        {client && !pickingClient ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2 ring-1 ring-inset ring-primary/15">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary"><UserRound className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {client.displayName}
              {forPet?.clientId === client.id && <span className="font-normal text-muted-foreground"> · for {forPet.name}</span>}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove client" onClick={() => { setForPet(null); onClient(null); }}><X /></Button>
          </div>
        ) : pickingClient ? (
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><ClientPicker defaultOpen value={client} onChange={(c) => { onClient(c); setPickingClient(false); }} /></div>
            <Button variant="ghost" size="icon" aria-label="Cancel" onClick={() => setPickingClient(false)}><X /></Button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <PatientPicker
              value={null}
              placeholder="Find the patient — pet name, patient ID or phone"
              onChange={(p) => {
                if (!p?.owner) return;
                setForPet({ clientId: p.owner.id, name: p.name });
                onClient({ id: p.owner.id, displayName: p.owner.displayName, mobilePhone: p.owner.mobilePhone });
              }}
            />
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>Walk-in customer</span>
              <button type="button" onClick={() => setPickingClient(true)} className="font-medium text-primary hover:underline">Add client</button>
            </div>
          </div>
        )}
      </div>

      {client && prescriptions.length > 0 && <PrescriptionPanel prescriptions={prescriptions} onFind={onFindInShop} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length ? (
          <ul aria-label="Basket">
            {POS_BILL_SECTIONS.map((sec) => {
              const inSection = lines.filter((l) => lineSection(l) === sec.key);
              if (!inSection.length) return null;
              const subtotal = inSection.reduce((n, l) => n + lineAmounts(l, inclusive).grossMinor, 0);
              return [
                <li key={`h-${sec.key}`} role="presentation" className="sticky top-0 z-[1] flex items-center justify-between border-y bg-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur first:border-t-0">
                  <span>{sec.label}</span>
                  <span className="tabular normal-case tracking-normal">{fmtMoney(subtotal, currency)}</span>
                </li>,
                ...inSection.map((l) => {
              const a = lineAmounts(l, inclusive);
              const atLimit = !!blockReason(l.item, l.quantity, allowNegative) && !l.item.rxOnly;
              // Waiting from a visit (fee, given in the clinic, handed out): fixed quantity and price; a discount or removal only.
              const fixed = l.item.type === 'CHARGE';
              return (
                <li key={l.key} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.item.name}</p>
                      <p className="text-xs text-muted-foreground tabular">
                        {fmtMoney(l.priceMinor, currency)}{l.item.type === 'PRODUCT' && ` / ${l.item.unit}`}{fixed && <span> × {l.quantity} · {l.item.note ?? 'not yet paid'}</span>}
                        {l.prescriptionNo && <span className="text-primary"> · on {l.prescriptionNo}</span>}
                        {l.priceMinor !== l.item.priceMinor && <span className="text-warning"> (price changed)</span>}
                        {!!l.discountMinor && <span className="text-success"> · −{fmtMoney(l.discountMinor, currency)}</span>}
                        <span> · tax {bpToPct(l.item.taxRateBasisPoints)}</span>
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular">{fmtMoney(a.grossMinor, currency)}</p>
                  </div>
                  {l.rxNote && <p className="mt-1 text-2xs text-warning">Sold without a prescription: {l.rxNote}</p>}
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
                      {allowOverrides && <LineEditPopover line={l} currency={currency} discountOnly={fixed} onSave={(patch) => onChange(lines.map((x) => (x.key === l.key ? { ...x, ...patch } : x)))} />}
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.item.name}`} title={fixed ? 'Takes it out of this sale; it stays under Not yet invoiced' : undefined} onClick={() => setQty(l.key, 0)}><Trash2 /></Button>
                    </span>
                  </div>
                </li>
              );
                }),
              ];
            })}
          </ul>
        ) : (
          !client && waiting.length > 0 ? (
            <div className="grid gap-2 p-3">
              <p className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Stethoscope className="h-3.5 w-3.5 text-primary" /> Ready to pay · from today’s visits
              </p>
              <ul className="grid gap-1.5" aria-label="Ready to pay">
                {waiting.map((w) => (
                  <li key={w.client.id}>
                    <button type="button" onClick={() => onPickWaiting?.(w)} className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{w.client.displayName}{w.patients.length ? <span className="font-normal text-muted-foreground"> · {w.patients.join(', ')}</span> : null}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[w.charges ? `${w.charges} ${w.charges === 1 ? 'item' : 'items'}` : null, w.prescribed ? `${w.prescribed} on prescription` : null, w.vet].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {w.totalMinor > 0 && <span className="block text-sm font-semibold tabular">{fmtMoney(w.totalMinor, currency)}</span>}
                        <span className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" />{new Date(w.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="px-1 text-xs text-muted-foreground">Tap a client to bring up their bill, or scan an item to start a shop sale.</p>
            </div>
          ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <ShoppingCart className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-medium">No items yet</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Scan a barcode, search, or tap an item to start a sale.</p>
            </div>
          </div>
          )
        )}
      </div>

      <div className="border-t bg-muted/30 p-4">
        {onOtherItem && (
          <Button type="button" variant="outline" size="sm" className="mb-2 w-full border-dashed" onClick={onOtherItem}><Plus /> Other item</Button>
        )}
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><dt>{items} item{items === 1 ? '' : 's'} · subtotal (excl. tax)</dt><dd className="tabular">{fmtMoney(totals.subtotalMinor, currency)}</dd></div>
          {totals.discountMinor - saleDiscountMinor > 0 && <div className="flex justify-between text-success"><dt>Discounts</dt><dd className="tabular">−{fmtMoney(totals.discountMinor - saleDiscountMinor, currency)}</dd></div>}
          {saleDiscount && saleDiscountMinor > 0 ? (
            <div className="flex items-center justify-between text-success">
              <dt className="flex items-center gap-1">Sale discount{saleDiscount.mode === 'PCT' ? ` (${saleDiscount.value}%)` : ''}<Button variant="ghost" size="icon-sm" className="h-5 w-5" aria-label="Remove the sale discount" onClick={() => onSaleDiscount(null)}><X /></Button></dt>
              <dd className="tabular">−{fmtMoney(saleDiscountMinor, currency)}</dd>
            </div>
          ) : allowOverrides && lines.length > 0 ? (
            <div className="flex justify-end"><SaleDiscountPopover currency={currency} onApply={onSaleDiscount} /></div>
          ) : null}
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
