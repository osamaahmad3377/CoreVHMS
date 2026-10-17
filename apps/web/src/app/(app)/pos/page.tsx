'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, History, Landmark, Printer, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { TakePaymentDialog } from '@/components/billing/take-payment-dialog';
import type { PickedClient } from '@/components/clients/client-picker';
import { FormError } from '@/components/forms/form-error';
import { PageHeader } from '@/components/page';
import { PosCart } from '@/components/pos/cart';
import { PosCatalog } from '@/components/pos/catalog';
import { blockReason, cartTotals, toInvoiceLines, type CartLine, type Tender } from '@/components/pos/model';
import { useConfirm } from '@/components/confirm';
import { receiptFromInvoice, type ReceiptPayment } from '@/components/receipts/receipt-document';
import { ReceiptPreview, useReceiptPrinter } from '@/components/receipts/use-receipt';
import { HeldSalesDialog, TodaySalesDialog, type HeldSale } from '@/components/pos/sales-dialogs';
import { TenderDialog } from '@/components/pos/tender-dialog';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/misc';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api, qs } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtTime } from '@/lib/format';
import { localDate, todayIn } from '@/lib/time';
import { useSession } from '@/lib/session';
import type { BillingSettings, CashRegister, Invoice, Payment, PosCatalog as Catalog, PosItem, ProductCategory } from '@/lib/types';

interface SaleResult {
  invoice: Invoice;
  payments: ReceiptPayment[];
  tenderedCashMinor: number;
  changeMinor: number;
  error: string | null;
}

interface PrintJob {
  invoice: Invoice;
  payments: ReceiptPayment[];
  tenderedCashMinor?: number;
  changeMinor?: number;
  servedBy?: string | null;
}

const readHeld = (key: string): HeldSale[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
};
const writeHeld = (key: string, held: HeldSale[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(held));
  } catch {
    /* storage unavailable: held sales simply are not persisted */
  }
};

function Pos() {
  const qc = useQueryClient();
  const { can, currency, session } = useSession();
  const tz = session.branch?.timezone ?? 'UTC';
  const searchRef = useRef<HTMLInputElement>(null);
  const receipts = useReceiptPrinter();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [tendering, setTendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [showToday, setShowToday] = useState(false);
  const [showHeld, setShowHeld] = useState(false);
  const [payBalance, setPayBalance] = useState(false);
  const heldKey = `vcms.pos.held.${session.organization?.id}.${session.branch?.id}`;
  const [held, setHeld] = useState<HeldSale[]>([]);
  useEffect(() => setHeld(readHeld(heldKey)), [heldKey]);

  const q = useDebounce(search.trim(), 200);
  const catalog = useQuery({
    queryKey: ['pos', 'catalog', category, categoryId, q],
    queryFn: () => api.get<Catalog>(`/pos/catalog${qs({ q, category, categoryId: categoryId || undefined })}`),
    placeholderData: (p) => p,
  });
  const shelves = useQuery({ queryKey: ['product-categories'], queryFn: () => api.get<ProductCategory[]>('/product-categories'), staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get<BillingSettings>('/billing/settings'), retry: false });
  const registers = useQuery({ queryKey: ['cash', 'registers', session.branch?.id], queryFn: () => api.get<CashRegister[]>(`/cash/registers${qs({ branchId: session.branch?.id })}`), enabled: !!session.branch });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000 });

  const inclusive = settings.data?.pricesIncludeTax ?? false;
  const allowNegative = catalog.data?.allowNegativeStock ?? false;
  const openRegister = (registers.data ?? []).find((r) => r.sessions.length);
  const cashBlocked = !!settings.data?.requireCashSession && registers.isSuccess && !openRegister;
  const totals = useMemo(() => cartTotals(lines, inclusive), [lines, inclusive]);
  const qtyInCart = useCallback((item: PosItem) => lines.filter((l) => l.item.type === item.type && l.item.id === item.id).reduce((n, l) => n + l.quantity, 0), [lines]);

  const add = useCallback(
    (item: PosItem) => {
      const reason = blockReason(item, qtyInCart(item), allowNegative);
      if (reason) {
        toast.error(`${item.name}: ${reason.toLowerCase()}`);
        return;
      }
      setLines((ls) => {
        const existing = ls.find((l) => l.item.type === item.type && l.item.id === item.id);
        return existing ? ls.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { key: crypto.randomUUID(), item, quantity: 1, priceMinor: item.priceMinor!, discountMinor: 0 }];
      });
    },
    [qtyInCart, allowNegative],
  );

  /** Enter in the search box: a barcode scanner or a typed SKU/code adds the item directly. */
  const submitSearch = async (value: string) => {
    const term = value.trim();
    if (!term) return;
    const data = await qc.fetchQuery({ queryKey: ['pos', 'catalog', '', term], queryFn: () => api.get<Catalog>(`/pos/catalog${qs({ q: term })}`) });
    const sellable = data.items.filter((i) => !i.rxOnly);
    const hit = data.exact ?? (sellable.length === 1 ? sellable[0] : null);
    if (hit) {
      add(hit);
      setSearch('');
    } else if (!data.items.length) {
      toast.error(`No item found for “${term}”`);
    }
  };

  const clearSale = () => {
    setLines([]);
    setClient(null);
    setSearch('');
    searchRef.current?.focus();
  };

  const hold = () => {
    const next = [{ id: crypto.randomUUID(), at: new Date().toISOString(), client, lines }, ...held].slice(0, 20);
    setHeld(next);
    writeHeld(heldKey, next);
    toast.success('Sale held');
    clearSale();
  };

  const recall = async (h: HeldSale) => {
    if (lines.length) {
      const c = await confirm({ title: 'Replace the current basket?', description: 'The items in the basket now will be removed and the held sale loaded instead. Hold the current basket first if you still need it.', confirmLabel: 'Replace basket' });
      if (!c.confirmed) return;
    }
    setLines(h.lines);
    setClient(h.client);
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next);
    writeHeld(heldKey, next);
    setShowHeld(false);
    // Stock and prices are refreshed so the recalled basket is validated against current data.
    qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
  };

  const complete = async (tenders: Tender[], changeMinor: number) => {
    setBusy(true);
    let invoice: Invoice;
    try {
      invoice = await api.post<Invoice>('/invoices', { isPos: true, clientId: client?.id ?? null, lines: toInvoiceLines(lines), issue: true });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof ApiError ? e.message : 'The sale could not be completed');
      return;
    }
    // Change comes out of cash: reduce the cash tenders (last first) by the change given.
    let change = changeMinor;
    const applied = [...tenders].reverse().map((t) => {
      if (t.method !== 'CASH' || change <= 0) return { ...t, applied: t.amountMinor };
      const cut = Math.min(change, t.amountMinor);
      change -= cut;
      return { ...t, applied: t.amountMinor - cut };
    }).reverse();
    const tenderedCash = tenders.filter((t) => t.method === 'CASH').reduce((n, t) => n + t.amountMinor, 0);
    const recorded: ReceiptPayment[] = [];
    let error: string | null = null;
    for (const t of applied) {
      if (t.applied <= 0) continue;
      try {
        const p = await api.post<Payment>('/payments', {
          clientId: client?.id ?? null,
          amountMinor: t.applied,
          method: t.method,
          reference: t.reference || null,
          notes: t.method === 'CASH' && changeMinor ? `Cash tendered ${fmtMoney(tenderedCash, currency)}, change ${fmtMoney(changeMinor, currency)}` : null,
          allocations: [{ invoiceId: invoice.id, amountMinor: t.applied }],
          idempotencyKey: t.key,
        });
        recorded.push({ method: t.method, amountMinor: t.applied, receiptNo: p.receiptNo, reference: t.reference || null });
      } catch (e) {
        error = `Sale ${invoice.invoiceNo} was issued, but the ${t.method.toLowerCase().replace('_', ' ')} payment was not recorded: ${e instanceof ApiError ? e.message : 'network error'}. Take the remaining balance below.`;
        break;
      }
    }
    ['invoices', 'payments', 'dashboard', 'cash', 'stock', 'pos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    setBusy(false);
    setTendering(false);
    setResult({ invoice, payments: recorded, tenderedCashMinor: tenderedCash, changeMinor: error ? 0 : changeMinor, error });
    // Optional automatic print after each counter sale (Settings → Receipts & printing).
    if (!error && receipts.ctx?.settings.autoPrint) setPrintJob({ invoice, payments: recorded, tenderedCashMinor: tenderedCash, changeMinor, servedBy: session.user.name });
    if (!error) toast.success(`Sale ${invoice.invoiceNo} complete`);
  };

  const newSale = () => {
    setResult(null);
    clearSale();
  };

  // Keyboard: F2 focuses the scanner/search field, F9 opens payment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        if (!result) searchRef.current?.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (!result && lines.length && totals.totalMinor > 0) setTendering(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, lines.length, totals.totalMinor]);

  // Print in a frame sized to the receipt roll (paper width, logo and copies from the receipt settings).
  useEffect(() => {
    if (!printJob) return;
    receipts
      .print(receiptFromInvoice(printJob.invoice, printJob.payments, { tenderedMinor: printJob.tenderedCashMinor, changeMinor: printJob.changeMinor, servedBy: printJob.servedBy }))
      .finally(() => setPrintJob(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  const header = (
    <PageHeader
        help="pos"
      title="Point of sale"
      description={`${session.branch?.name ?? ''} · ${session.user.name}`}
      actions={
        <>
          {openRegister ? (
            localDate(openRegister.sessions[0].openedAt, tz) === todayIn(tz) ? (
              <Badge variant="success" className="gap-1 py-1"><Landmark className="h-3 w-3" /> {openRegister.name} open since {fmtTime(openRegister.sessions[0].openedAt)}</Badge>
            ) : (
              <span className="inline-flex" title="This register was opened on an earlier day and not closed. Count and close it, then open today’s session.">
                {can('cash.manage') ? (
                  <Link href="/billing/cash"><Badge variant="warning" className="gap-1 py-1"><Landmark className="h-3 w-3" /> {openRegister.name} still open from {fmtDateTime(openRegister.sessions[0].openedAt)} — close it</Badge></Link>
                ) : (
                  <Badge variant="warning" className="gap-1 py-1"><Landmark className="h-3 w-3" /> {openRegister.name} still open from {fmtDateTime(openRegister.sessions[0].openedAt)} — ask a manager to close it</Badge>
                )}
              </span>
            )
          ) : registers.isSuccess ? (
            <Badge variant={cashBlocked ? 'destructive' : 'secondary'} className="gap-1 py-1"><Landmark className="h-3 w-3" /> No register open{cashBlocked ? ' · cash unavailable' : ''}</Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setShowHeld(true)}><Clock /> Held{held.length ? ` (${held.length})` : ''}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowToday(true)}><History /> Today’s sales</Button>
        </>
      }
    />
  );

  const dialogs = (
    <>
      <TodaySalesDialog
        open={showToday}
        onOpenChange={setShowToday}
        clinic={org.data ?? null}
        currency={currency}
        onReprint={(inv) => {
          setShowToday(false);
          setPrintJob({ invoice: inv, payments: inv.allocations.map((a) => ({ method: a.payment.method, amountMinor: a.amountMinor, receiptNo: a.payment.receiptNo })) });
        }}
      />
      <HeldSalesDialog open={showHeld} onOpenChange={setShowHeld} held={held} currency={currency} onRecall={recall} onDelete={(id) => { const next = held.filter((h) => h.id !== id); setHeld(next); writeHeld(heldKey, next); }} totalOf={(ls) => cartTotals(ls, inclusive).totalMinor} />
    </>
  );

  if (result) {
    const inv = result.invoice;
    const paid = result.payments.reduce((n, p) => n + p.amountMinor, 0);
    const balance = inv.totalMinor - paid;
    return (
      <>
        <div className="print:hidden">
          {header}
          {result.error && <div className="mb-4"><FormError message={result.error} /></div>}
          <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[1fr_320px]">
            <div className="rounded-lg border bg-muted/40 p-4">
              <ReceiptPreview data={receiptFromInvoice(inv, result.payments, { tenderedMinor: result.tenderedCashMinor, changeMinor: result.changeMinor, servedBy: session.user.name })} />
            </div>
            <div className="grid content-start gap-4 text-center">
              <CheckCircle2 className={`mx-auto h-14 w-14 ${balance > 0 ? 'text-warning' : 'text-success'}`} />
              <div>
                <p className="text-sm text-muted-foreground">{inv.invoiceNo}</p>
                <p className="text-3xl font-bold tabular">{fmtMoney(inv.totalMinor, currency)}</p>
                <p className="text-sm text-muted-foreground">{balance > 0 ? `${fmtMoney(balance, currency)} still to pay` : `Paid by ${[...new Set(result.payments.map((p) => p.method.toLowerCase().replace('_', ' ')))].join(' + ')}`}</p>
              </div>
              {result.changeMinor > 0 && (
                <div className="rounded-lg border-2 border-success bg-success/10 p-4">
                  <p className="text-sm font-medium text-success">Change due</p>
                  <p className="text-4xl font-bold tabular text-success">{fmtMoney(result.changeMinor, currency)}</p>
                </div>
              )}
              {balance > 0 && can('payments.take') && <Button onClick={() => setPayBalance(true)}>Take remaining payment</Button>}
              <Button size="lg" className="h-12 text-base" autoFocus onClick={newSale}>New sale</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" loading={!!printJob} onClick={() => setPrintJob({ invoice: inv, payments: result.payments, tenderedCashMinor: result.tenderedCashMinor, changeMinor: result.changeMinor, servedBy: session.user.name })}><Printer /> Print receipt</Button>
                <Button variant="outline" asChild><Link href={`/billing/invoices/${inv.id}`}><ReceiptText /> Invoice</Link></Button>
              </div>
            </div>
          </div>
        </div>
        {dialogs}
        <TakePaymentDialog
          open={payBalance}
          onOpenChange={setPayBalance}
          clientId={inv.clientId}
          invoice={{ ...inv, balanceMinor: balance }}
          onPaid={(p) => setResult((r) => r && { ...r, error: null, payments: [...r.payments, { method: p.method, amountMinor: p.allocatedMinor, receiptNo: p.receiptNo }] })}
        />
      </>
    );
  }

  return (
    <>
      <div className="print:hidden">
        {header}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-20 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_420px]">
          <PosCatalog
            ref={searchRef}
            search={search}
            onSearch={setSearch}
            onSubmit={submitSearch}
            category={category}
            onCategory={(c) => { setCategory(c); setCategoryId(''); }}
            shelves={(shelves.data ?? []).filter((s) => category && category !== 'SERVICE' && s.productType === category)}
            shelf={categoryId}
            onShelf={setCategoryId}
            items={catalog.data?.items ?? []}
            loading={catalog.isFetching}
            qtyInCart={qtyInCart}
            allowNegative={allowNegative}
            currency={currency}
            onAdd={add}
          />
          <div id="pos-basket" className="scroll-mt-20 lg:sticky lg:top-20 lg:h-[calc(100vh-10.5rem)]">
            <PosCart
              lines={lines}
              onChange={setLines}
              client={client}
              onClient={setClient}
              totals={totals}
              inclusive={inclusive}
              allowOverrides={can('billing.write')}
              allowNegative={allowNegative}
              currency={currency}
              onCharge={() => setTendering(true)}
              onHold={hold}
              onClear={clearSale}
            />
          </div>
        </div>
        {/* Phones and tablets: the basket sits below the shelves, so keep the total and Charge within thumb reach. */}
        {lines.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t bg-card/95 px-4 py-2.5 shadow-[0_-4px_12px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => document.getElementById('pos-basket')?.scrollIntoView({ behavior: 'smooth' })}>
              <span className="block text-xs text-muted-foreground">{lines.length} {lines.length === 1 ? 'item' : 'items'} · view basket</span>
              <span className="block truncate text-base font-semibold tabular">{fmtMoney(totals.totalMinor, currency)}</span>
            </button>
            <Button size="lg" disabled={totals.totalMinor <= 0} onClick={() => setTendering(true)}>Charge</Button>
          </div>
        )}
        <p className="mt-3 hidden text-xs text-muted-foreground xl:block">
          <Kbd>F2</Kbd> scan / search · <Kbd>Enter</Kbd> add scanned code · <Kbd>F9</Kbd> take payment · <Kbd>Esc</Kbd> clear search
        </p>
      </div>
      <TenderDialog open={tendering} onOpenChange={setTendering} dueMinor={totals.totalMinor} currency={currency} cashBlocked={cashBlocked} canManageCash={can('cash.manage')} busy={busy} onComplete={complete} />
      {dialogs}
    </>
  );
}

export default function PosPage() {
  return (
    <RequirePermission anyOf={['pos.use']}>
      <Pos />
    </RequirePermission>
  );
}
