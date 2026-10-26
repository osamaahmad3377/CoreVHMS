'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowRightLeft, ArrowUpRight, CalendarClock, CheckCircle2, Info, PackageX, ShoppingCart, Sparkles, Truck } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { Field } from '@/components/forms/field';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type Status = 'OUT' | 'RUNS_OUT' | 'ORDER_SOON' | 'BELOW_LEVEL' | 'OK' | 'UNUSED';
interface Ref {
  id: string;
  name: string;
}
interface Row {
  product: { id: string; name: string; sku: string | null; type: string; unit: string };
  branch: Ref;
  available: number;
  onOrder: number;
  weekly: number;
  history: number[];
  trend: 'UP' | 'DOWN' | 'STEADY';
  daysLeft: number | null;
  runOutDay: number | null;
  runOutDate: string | null;
  emptyDate: string | null;
  status: Status;
  scheduled: number;
  waste: { batchNumber: string; quantity: number; expiryDate: string | null }[];
  need: number;
  transferIn: number;
  order: number;
  lastCostMinor: number | null;
  supplier: Ref | null;
}
interface OrderLine {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitCostMinor: number;
  status: Status;
  runOutDate: string | null;
  available: number;
  weekly: number;
  onOrder: number;
  transferIn: number;
  expiring: { quantity: number; date: string | null } | null;
}
interface SupplierOrder {
  supplier: Ref | null;
  branch: Ref;
  lines: OrderLine[];
  totalMinor: number;
}
interface Transfer {
  product: { id: string; name: string; unit: string };
  from: Ref;
  to: Ref;
  quantity: number;
  reason: 'SHORTAGE' | 'EXPIRY';
  batchId: string | null;
  batchNumber: string | null;
  expiryDate: string | null;
  toRunOutDate: string | null;
  fromAvailable: number;
  fromWeekly: number;
  savesMinor: number;
}
interface Forecast {
  generatedAt: string;
  options: { horizonDays: number; leadDays: number; coverDays: number; window: number };
  branches: Ref[];
  rows: Row[];
  orders: SupplierOrder[];
  transfers: Transfer[];
  summary: { out: number; runsOut: number; orderSoon: number; orderLines: number; orderValueMinor: number; noSupplier: number; transfers: number; expiryTransfers: number; wasteValueMinor: number };
}

const qty = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));
/** "135 tablets", "1 dose", "250 mL" — measures (mL, g…) are never made plural. */
const units = (n: number, unit: string) => {
  const plural = Math.abs(n - 1) > 1e-9 && /^[a-z]{3,}$/i.test(unit) && !/s$/i.test(unit) && !/^(ml|mg|mcg|kg|gram|litre|liter)$/i.test(unit);
  return `${qty(n)} ${plural ? `${unit}s` : unit}`;
};
const perWeek = (n: number) => (n === 0 ? '—' : n < 1 ? '<1' : qty(n));

/** "Today", "Tomorrow", "Thu 30 Oct". */
function dayLabel(iso: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const STATUS: Record<Status, { label: string; variant: 'destructive' | 'warning' | 'success' | 'secondary' }> = {
  OUT: { label: 'Out of stock', variant: 'destructive' },
  RUNS_OUT: { label: 'Runs out', variant: 'destructive' },
  ORDER_SOON: { label: 'Order soon', variant: 'warning' },
  BELOW_LEVEL: { label: 'Below reorder level', variant: 'warning' },
  OK: { label: 'Enough', variant: 'success' },
  UNUSED: { label: 'Not used lately', variant: 'secondary' },
};

function StatusBadge({ s, date }: { s: Status; date?: string | null }) {
  const st = STATUS[s];
  return <Badge variant={st.variant}>{s === 'RUNS_OUT' && date ? `Runs out ${dayLabel(date)}` : st.label}</Badge>;
}

/** Eight weeks of use as a small line, with the trend. */
function Spark({ history, trend }: { history: number[]; trend: Row['trend'] }) {
  const w = 64;
  const h = 20;
  const max = Math.max(...history, 1);
  const pts = history.map((v, i) => `${history.length === 1 ? w / 2 : (i / (history.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  const Arrow = trend === 'UP' ? ArrowUpRight : trend === 'DOWN' ? ArrowDownRight : null;
  return (
    <span className="inline-flex items-center gap-1" title={`Last ${history.length} weeks: ${history.map(qty).join(', ')}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary" aria-hidden>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {Arrow && <Arrow className={cn('h-3.5 w-3.5', trend === 'UP' ? 'text-warning' : 'text-muted-foreground')} aria-label={trend === 'UP' ? 'Use is rising' : 'Use is falling'} />}
    </span>
  );
}

function ForecastPage() {
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const url = useUrlState();
  const horizonDays = Number(url.get('days', '7'));
  const coverDays = Number(url.get('cover', '14'));
  const branchId = url.get('branch');
  const tab = url.get('tab', 'order');
  const params = { horizonDays, coverDays, branchId: branchId || undefined };
  const q = useQuery({ queryKey: ['stock-forecast', params], queryFn: () => api.get<Forecast>(`/stock/forecast${qs(params)}`), placeholderData: (p) => p });
  const money = (m: number) => fmtMoney(m, currency);
  const refresh = () => ['stock-forecast', 'stock', 'purchase-orders', 'reorder-suggestions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data!;
  const s = f.summary;
  const windowText = `${f.options.leadDays} days for delivery + ${coverDays === 7 ? '1 week' : `${coverDays / 7} weeks`}`;

  return (
    <>
      <PageHeader
        title="Stock forecast"
        description="What will run out, a ready order for each supplier, and stock to move between branches — worked out from the last 8 weeks of use."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Look ahead" className="h-9 w-auto" value={String(horizonDays)} onChange={(e) => url.set({ days: e.target.value === '7' ? null : e.target.value })}>
              <option value="7">Next 7 days</option>
              <option value="14">Next 14 days</option>
              <option value="30">Next 30 days</option>
            </NativeSelect>
            <NativeSelect aria-label="Order enough for" className="h-9 w-auto" value={String(coverDays)} onChange={(e) => url.set({ cover: e.target.value === '14' ? null : e.target.value })}>
              <option value="7">Order for 1 week</option>
              <option value="14">Order for 2 weeks</option>
              <option value="28">Order for 4 weeks</option>
            </NativeSelect>
            {f.branches.length > 1 && (
              <NativeSelect aria-label="Branch" className="h-9 w-auto" value={branchId} onChange={(e) => url.set({ branch: e.target.value || null })}>
                <option value="">All branches</option>
                {f.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        }
      />
      <SectionNav links={INVENTORY_LINKS} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Run out in ${horizonDays} days`} value={s.runsOut} icon={CalendarClock} tone={s.runsOut ? 'danger' : 'success'} hint={s.runsOut ? 'Order or move stock now' : 'Nothing runs out'} />
        <Stat label="Already out of stock" value={s.out} icon={PackageX} tone={s.out ? 'danger' : 'default'} hint={s.orderSoon ? `${s.orderSoon} more to order soon` : undefined} />
        <Stat label="Ready to order" value={money(s.orderValueMinor)} icon={ShoppingCart} tone="default" hint={`${s.orderLines} ${s.orderLines === 1 ? 'product' : 'products'} · ${f.orders.length} ${f.orders.length === 1 ? 'order' : 'orders'}`} />
        <Stat label="Move between branches" value={s.transfers} icon={ArrowRightLeft} tone={s.transfers ? 'warning' : 'default'} hint={s.expiryTransfers ? `${s.expiryTransfers} before it expires` : s.transfers ? 'Instead of buying' : 'Branches are balanced'} />
      </div>

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === 'order' ? null : v })}>
        <TabsList className="mb-4">
          <TabsTrigger value="order">
            <Truck /> Order from suppliers {f.orders.length > 0 && <Badge variant="secondary">{s.orderLines}</Badge>}
          </TabsTrigger>
          {f.branches.length > 1 && (
            <TabsTrigger value="move">
              <ArrowRightLeft /> Move between branches {f.transfers.length > 0 && <Badge variant="warning">{f.transfers.length}</Badge>}
            </TabsTrigger>
          )}
          <TabsTrigger value="all">All products</TabsTrigger>
        </TabsList>

        <TabsContent value="order">
          <OrdersTab f={f} windowText={windowText} money={money} canOrder={can('procurement.write')} onDone={refresh} />
        </TabsContent>
        <TabsContent value="move">
          <TransfersTab f={f} money={money} canMove={can('inventory.adjust')} onDone={refresh} />
        </TabsContent>
        <TabsContent value="all">
          <AllTab f={f} />
        </TabsContent>
      </Tabs>

      <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        How it works: use per week is the last 8 weeks of medicines dispensed, given and sold (recent weeks count more), plus vaccinations due. Stock that expires first is used first; orders already placed are counted. Orders cover {windowText} plus 3 days’ extra, and never less than the product’s usual reorder quantity. Updated {new Date(f.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.
      </p>
    </>
  );
}

// ── Order from suppliers ──

function OrdersTab({ f, windowText, money, canOrder, onDone }: { f: Forecast; windowText: string; money: (m: number) => string; canOrder: boolean; onDone: () => void }) {
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Ref[]>('/suppliers'), enabled: canOrder && f.orders.some((o) => !o.supplier) });
  // Editable copy: quantity per line, lines left out, supplier for "no supplier yet".
  const key = (o: SupplierOrder) => `${o.supplier?.id ?? 'none'}:${o.branch.id}`;
  const [qtyOf, setQty] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [pickSupplier, setPick] = useState<Record<string, string>>({});
  useEffect(() => {
    setQty({});
    setSkip({});
  }, [f.generatedAt]);
  const lineKey = (o: SupplierOrder, l: OrderLine) => `${key(o)}:${l.productId}`;
  const linesOf = (o: SupplierOrder) =>
    o.lines
      .filter((l) => !skip[lineKey(o, l)])
      .map((l) => ({ productId: l.productId, quantity: Number(qtyOf[lineKey(o, l)] ?? l.quantity), unitCostMinor: l.unitCostMinor }))
      .filter((l) => l.quantity > 0);
  const totalOf = (o: SupplierOrder) => linesOf(o).reduce((n, l) => n + Math.round(l.quantity * l.unitCostMinor), 0);

  const prepare = useMutation({
    mutationFn: (orders: SupplierOrder[]) =>
      api.post<{ created: { id: string; poNo: string; supplier: string; branch: string }[] }>('/stock/forecast/orders', {
        orders: orders.map((o) => ({ supplierId: o.supplier?.id ?? pickSupplier[key(o)], branchId: o.branch.id, lines: linesOf(o) })),
      }),
    onSuccess: (r) => {
      const first = r.created[0];
      toast.success(r.created.length === 1 ? `${first.poNo} prepared for ${first.supplier} — check it and send it` : `${r.created.length} purchase orders prepared — check them and send them`, {
        action: { label: r.created.length === 1 ? 'Open' : 'View orders', onClick: () => (window.location.href = r.created.length === 1 ? `/inventory/purchase-orders/${first.id}` : '/inventory/purchase-orders') },
      });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!f.orders.length) {
    return (
      <Card>
        <EmptyState icon={CheckCircle2} title="Nothing to order" description={`Every product lasts beyond ${windowText}, counting orders already placed${f.transfers.length ? ' and the moves between branches' : ''}.`} />
      </Card>
    );
  }
  const ready = f.orders.filter((o) => (o.supplier || pickSupplier[key(o)]) && linesOf(o).length);
  return (
    <div className="grid gap-4">
      {canOrder && (
        <div className="flex flex-col gap-3 rounded-2xl surface-flat p-3 text-sm sm:flex-row sm:items-center">
          <Sparkles className="hidden h-4 w-4 shrink-0 text-primary sm:block" />
          <span className="min-w-0 flex-1">
            One draft purchase order per supplier and branch, enough for <strong>{windowText}</strong>. Change any quantity, then prepare — nothing is sent until you approve it.
          </span>
          {ready.length > 1 && (
            <Button loading={prepare.isPending} onClick={() => prepare.mutate(ready)}>
              <ShoppingCart /> Prepare all {ready.length} orders
            </Button>
          )}
        </div>
      )}
      {f.orders.map((o) => (
        <Card key={key(o)} className="overflow-hidden">
          <CardHeader className="flex-wrap gap-3">
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                {o.supplier ? o.supplier.name : <span className="text-warning">No supplier yet</span>}
                <span className="text-sm font-normal text-muted-foreground">→ {o.branch.name}</span>
              </CardTitle>
              {!o.supplier && <p className="mt-1 text-xs text-muted-foreground">These were never received from a supplier. Choose who to order from.</p>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!o.supplier && canOrder && (
                <NativeSelect aria-label="Supplier" className="h-9 w-48" value={pickSupplier[key(o)] ?? ''} onChange={(e) => setPick({ ...pickSupplier, [key(o)]: e.target.value })}>
                  <option value="">Choose supplier…</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <span className="text-sm font-semibold tabular">{money(totalOf(o))}</span>
              {canOrder && (
                <Button size="sm" disabled={!(o.supplier || pickSupplier[key(o)]) || !linesOf(o).length} loading={prepare.isPending && prepare.variables?.length === 1 && prepare.variables[0] === o} onClick={() => prepare.mutate([o])}>
                  <ShoppingCart /> Prepare order
                </Button>
              )}
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
                <tr>
                  {canOrder && <th className="w-10 px-3 py-2" />}
                  <th className="px-3 py-2 text-left font-semibold">Product</th>
                  <th className="px-3 py-2 text-right font-semibold">In stock</th>
                  <th className="px-3 py-2 text-right font-semibold">Uses a week</th>
                  <th className="px-3 py-2 text-left font-semibold">Runs out</th>
                  <th className="px-3 py-2 text-right font-semibold">Order</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost each</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => {
                  const k = lineKey(o, l);
                  const off = !!skip[k];
                  const q = Number(qtyOf[k] ?? l.quantity);
                  return (
                    <tr key={l.productId} className={cn('border-t', off && 'opacity-45')}>
                      {canOrder && (
                        <td className="px-3 py-2">
                          <Checkbox checked={!off} onCheckedChange={(v) => setSkip({ ...skip, [k]: !v })} aria-label={`Include ${l.name}`} />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Link href={`/inventory/products/${l.productId}`} className="font-medium hover:underline">
                          {l.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {l.onOrder > 0 && `${qty(l.onOrder)} already on order · `}
                          {l.transferIn > 0 && <span className="text-primary">{qty(l.transferIn)} coming from another branch · </span>}
                          {l.unit}
                        </p>
                        {l.expiring && (
                          <p className="text-xs font-medium text-warning">
                            {qty(l.expiring.quantity)} expire {dayLabel(l.expiring.date)} — won’t be used in time
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular">{qty(l.available)}</td>
                      <td className="px-3 py-2 text-right tabular">{perWeek(l.weekly)}</td>
                      <td className="px-3 py-2">
                        <StatusBadge s={l.status} date={l.runOutDate} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canOrder ? (
                          <Input aria-label={`Order quantity for ${l.name}`} className="ml-auto h-8 w-20 text-right tabular" inputMode="decimal" disabled={off} value={qtyOf[k] ?? String(l.quantity)} onChange={(e) => setQty({ ...qtyOf, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
                        ) : (
                          <span className="font-semibold tabular">{qty(l.quantity)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">{l.unitCostMinor ? money(l.unitCostMinor) : '—'}</td>
                      <td className="px-3 py-2 text-right font-medium tabular">{l.unitCostMinor && !off ? money(Math.round(q * l.unitCostMinor)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Move between branches ──

function TransfersTab({ f, money, canMove, onDone }: { f: Forecast; money: (m: number) => string; canMove: boolean; onDone: () => void }) {
  const [moving, setMoving] = useState<Transfer | null>(null);
  if (!f.transfers.length) {
    return (
      <Card>
        <EmptyState icon={CheckCircle2} title="Branches are balanced" description="No branch has spare stock that another branch is about to run out of, and nothing will expire unused." />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {f.transfers.map((t, i) => (
        <Card key={i} className="grid gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', t.reason === 'EXPIRY' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')}>
              {t.reason === 'EXPIRY' ? <AlertTriangle className="h-5 w-5" /> : <ArrowRightLeft className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <Link href={`/inventory/products/${t.product.id}`} className="font-semibold hover:underline">
                {t.product.name}
              </Link>
              <p className="text-lg font-semibold tabular">{units(t.quantity, t.product.unit)}</p>
            </div>
            {t.reason === 'EXPIRY' ? <Badge variant="warning">Before it expires</Badge> : <Badge>Instead of buying</Badge>}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl bg-foreground/[0.03] p-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{t.from.name}</p>
              <p className="text-xs text-muted-foreground">
                has {qty(t.fromAvailable)} · uses {perWeek(t.fromWeekly)} a week
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{t.to.name}</p>
              <p className={cn('text-xs', t.toRunOutDate ? 'text-destructive' : 'text-muted-foreground')}>{t.toRunOutDate ? `runs out ${dayLabel(t.toRunOutDate)}` : 'needs more soon'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t.reason === 'EXPIRY' ? (
              <span>
                Batch {t.batchNumber} expires {dayLabel(t.expiryDate)} — {t.from.name} won’t use it in time; {t.to.name} will.
              </span>
            ) : (
              <span>{t.savesMinor > 0 ? `Saves buying about ${money(t.savesMinor)}.` : 'Saves buying it.'} {t.from.name} keeps enough for its own use.</span>
            )}
            {canMove && (
              <Button size="sm" className="ml-auto" onClick={() => setMoving(t)}>
                <ArrowRightLeft /> Move now
              </Button>
            )}
          </div>
        </Card>
      ))}
      {moving && <MoveDialog t={moving} onClose={() => setMoving(null)} onDone={onDone} />}
    </div>
  );
}

function MoveDialog({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(t.quantity));
  const move = useMutation({
    mutationFn: () => api.post<{ quantity: number; unit: string; toLocation: string }>('/stock/branch-transfers', { productId: t.product.id, fromBranchId: t.from.id, toBranchId: t.to.id, quantity: Number(amount), batchId: t.batchId }),
    onSuccess: (r) => {
      toast.success(`${units(r.quantity, r.unit)} of ${t.product.name} moved to ${t.to.name} (${r.toLocation})`);
      onDone();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Move {t.product.name}</DialogTitle>
          <DialogDescription>
            From {t.from.name} to {t.to.name}. {t.batchNumber ? `Batch ${t.batchNumber} (expires ${dayLabel(t.expiryDate)}).` : 'The batch that expires first goes first.'} Stock is taken off {t.from.name} now and added to {t.to.name}’s store room.
          </DialogDescription>
        </DialogHeader>
        <Field label={`How many (${t.product.unit})`} htmlFor="mv-q">
          <Input id="mv-q" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!(Number(amount) > 0)} loading={move.isPending} onClick={() => move.mutate()}>
            <ArrowRightLeft /> Move {amount && qty(Number(amount))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── All products ──

function AllTab({ f }: { f: Forecast }) {
  const [search, setSearch] = useState('');
  const [onlyAttention, setOnly] = useState(true);
  const rows = useMemo(
    () => f.rows.filter((r) => (!onlyAttention || ['OUT', 'RUNS_OUT', 'ORDER_SOON', 'BELOW_LEVEL'].includes(r.status) || r.waste.length) && (!search || r.product.name.toLowerCase().includes(search.toLowerCase()))),
    [f.rows, search, onlyAttention],
  );
  const multi = f.branches.length > 1;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Find a product" className="w-full max-w-xs" />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyAttention} onCheckedChange={(v) => setOnly(!!v)} /> Only what needs attention
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{rows.length} shown</span>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-foreground/[0.03] text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Product</th>
                {multi && <th className="px-3 py-2 text-left font-semibold">Branch</th>}
                <th className="px-3 py-2 text-right font-semibold">In stock</th>
                <th className="px-3 py-2 text-left font-semibold">Last 8 weeks</th>
                <th className="px-3 py-2 text-right font-semibold">Uses a week</th>
                <th className="px-3 py-2 text-left font-semibold">Lasts until</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.product.id}:${r.branch.id}`} className="border-t align-top">
                  <td className="px-3 py-2">
                    <Link href={`/inventory/products/${r.product.id}`} className="font-medium hover:underline">
                      {r.product.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.product.unit}
                      {r.onOrder > 0 && ` · ${qty(r.onOrder)} on order`}
                      {r.scheduled > 0 && ` · ${qty(r.scheduled)} for vaccinations due`}
                    </p>
                    {r.waste.map((w) => (
                      <p key={w.batchNumber} className="text-xs text-warning">
                        {qty(w.quantity)} of batch {w.batchNumber} will expire unused ({dayLabel(w.expiryDate)})
                      </p>
                    ))}
                  </td>
                  {multi && <td className="px-3 py-2 text-muted-foreground">{r.branch.name}</td>}
                  <td className="px-3 py-2 text-right tabular">{qty(r.available)}</td>
                  <td className="px-3 py-2">{r.weekly > 0 ? <Spark history={r.history} trend={r.trend} /> : <span className="text-xs text-muted-foreground">Not used</span>}</td>
                  <td className="px-3 py-2 text-right tabular">{perWeek(r.weekly)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.daysLeft === null ? '—' : r.daysLeft >= 366 ? 'Over a year' : r.daysLeft === 0 ? 'Empty' : `${dayLabel(r.emptyDate)} · ${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'}`}</td>
                  <td className="px-3 py-2">
                    <StatusBadge s={r.status} date={r.runOutDate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={onlyAttention ? CheckCircle2 : PackageX}
          title={onlyAttention ? 'Nothing needs attention' : 'No products yet'}
          description={onlyAttention ? 'Untick “Only what needs attention” to see every product.' : 'The forecast learns from what you dispense, give and sell. Receive stock and use it for a week.'}
        />
      )}
    </Card>
  );
}

export default function StockForecastPage() {
  return (
    <RequirePermission anyOf={['inventory.read', 'procurement.read']}>
      <Suspense>
        <ForecastPage />
      </Suspense>
    </RequirePermission>
  );
}
