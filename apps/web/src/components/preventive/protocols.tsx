'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CARE_KINDS, enumLabel, fromMinor, type Paginated } from '@vcms/shared';
import { BellRing, CalendarPlus, CheckCircle2, Edit, Plus, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '../billing/money';
import { DataTable } from '../data-table';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { EmptyState } from '../page';
import { ProductPicker } from '../pharmacy/product-picker';
import { CareStatusBadge, RepeatNote } from './care-plan';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CareItem, CareProtocol, Product } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Vaccines and dewormers: lists of their own, each with a price kept in Services & prices. */
export type CareKindWithPrice = 'VACCINATION' | 'DEWORMING';

/** The words for one kind of schedule (a dewormer list reads differently from general care protocols). */
const WORDS = {
  any: { one: 'protocol', new: 'New protocol', title: 'New care protocol', name: 'e.g. Canine core vaccination — annual booster', product: 'Product (optional)', productHint: 'Giving this product completes the item automatically', emptyTitle: 'No protocols yet', emptyText: 'Add your clinic’s vaccination, parasite-control and health-check schedules.' },
  VACCINATION: { one: 'vaccine', new: 'Add vaccine', title: 'Add a vaccine', name: 'e.g. Rabies — annual booster', product: 'Vaccine from stock', productHint: 'The vaccine in your stock; giving it completes the vaccination and takes it from stock', emptyTitle: 'No vaccines yet', emptyText: 'Add the vaccines your clinic gives, each with its vaccine from stock, how often it is repeated and its price.' },
  DEWORMING: { one: 'dewormer', new: 'Add dewormer', title: 'Add a dewormer', name: 'e.g. Praziquantel + pyrantel — adult dogs', product: 'Dewormer from stock', productHint: 'The product in your stock; giving it completes the deworming and takes it from stock', emptyTitle: 'No dewormers yet', emptyText: 'Add the dewormers your clinic uses, each with its product from stock and how often it is repeated.' },
} as const;

interface Species { id: string; name: string }

export function ProtocolDialog({ protocol, open, onOpenChange, kind }: { protocol: CareProtocol | null; open: boolean; onOpenChange: (o: boolean) => void; /** Fixed kind (the Vaccines tab, the Deworming page): no type to choose, and a price of its own. */ kind?: CareKindWithPrice }) {
  const w = WORDS[kind ?? 'any'];
  const { currency } = useSession();
  // Vaccines and dewormers have their own price: kept as a service in Settings → Services & prices.
  const priced = !!kind;
  const label = kind === 'VACCINATION' ? 'Vaccination' : 'Deworming';
  const [price, setPrice] = useState('');
  const qc = useQueryClient();
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), enabled: open });
  const blank = useMemo(() => ({ name: '', kind: (kind ?? 'VACCINATION') as string, speciesId: '', firstDueAgeWeeks: '', intervalDays: '', source: '', notes: '' }), [kind]);
  const [f, setF] = useState(blank);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(protocol ? { name: protocol.name, kind: protocol.kind, speciesId: protocol.speciesId ?? '', firstDueAgeWeeks: protocol.firstDueAgeWeeks?.toString() ?? '', intervalDays: protocol.intervalDays?.toString() ?? '', source: protocol.source, notes: protocol.notes ?? '' } : blank);
    setProduct(protocol?.product ? ({ ...protocol.product } as Product) : null);
    setPrice(protocol?.service ? fromMinor(protocol.service.priceMinor, currency) : '');
  }, [open, protocol, blank, currency]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        speciesId: f.speciesId || null,
        productId: product?.id ?? null,
        firstDueAgeWeeks: f.firstDueAgeWeeks || null,
        intervalDays: f.intervalDays || null,
        notes: f.notes || null,
        ...(priced ? { priceMinor: price.trim() ? parseMoney(price, currency) : null } : {}),
      };
      return protocol ? api.patch<CareProtocol>(`/care-protocols/${protocol.id}`, body) : api.post<CareProtocol>('/care-protocols', body);
    },
    onSuccess: (saved: CareProtocol) => {
      toast.success(saved.status === 'APPROVED' ? `${protocol?.name ?? saved.name} saved` : `${w.one[0].toUpperCase()}${w.one.slice(1)} saved — a vet must approve it before it is used`);
      qc.invalidateQueries({ queryKey: ['care-protocols'] });
      qc.invalidateQueries({ queryKey: ['care-options'] });
      qc.invalidateQueries({ queryKey: ['services'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{protocol ? `Edit ${protocol.name}` : w.title}</DialogTitle>
          <DialogDescription>Schedules come from your clinic’s veterinary guidance — the system ships none. Record where the schedule comes from; a vet approves it before it is applied to patients.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cp-name" required className="sm:col-span-2"><Input id="cp-name" value={f.name} maxLength={120} onChange={set('name')} placeholder={w.name} /></Field>
          {!kind && <Field label="Type" htmlFor="cp-kind"><NativeSelect id="cp-kind" value={f.kind} onChange={set('kind')}>{CARE_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>}
          <Field label="Species" htmlFor="cp-species"><NativeSelect id="cp-species" value={f.speciesId} onChange={set('speciesId')}><option value="">All species</option>{(species.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
          <Field label="First due at age (weeks)" htmlFor="cp-age" hint="Optional: for young animals"><Input id="cp-age" inputMode="numeric" value={f.firstDueAgeWeeks} onChange={set('firstDueAgeWeeks')} /></Field>
          <Field label="Repeat every (days)" htmlFor="cp-int" hint="Empty = one-off"><Input id="cp-int" inputMode="numeric" value={f.intervalDays} onChange={set('intervalDays')} /></Field>
          <Field label={w.product} htmlFor="cp-prod" hint={w.productHint} className="sm:col-span-2"><ProductPicker id="cp-prod" value={product} onChange={setProduct} prescribable type={kind === 'VACCINATION' ? 'VACCINE' : undefined} /></Field>
          {priced && (
            <Field
              label="Price"
              htmlFor="cp-price"
              className="sm:col-span-2"
              error={price.trim() && parseMoney(price, currency) === null ? 'Enter a valid amount' : undefined}
              hint={`Kept in Settings → Services & prices as “${label}: ${f.name.trim() || 'name'}”. Charged once when the ${label.toLowerCase()} is recorded — the ${w.one} from stock is included. Empty = the product is charged at its own price.`}
            >
              <MoneyInput id="cp-price" currency={currency} value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
          )}
          <Field label="Source / guideline" htmlFor="cp-source" required className="sm:col-span-2" hint="e.g. the guideline, manufacturer datasheet or practice policy this schedule follows"><Input id="cp-source" value={f.source} maxLength={500} onChange={set('source')} /></Field>
          <Field label="Notes" htmlFor="cp-notes" className="sm:col-span-2"><Textarea id="cp-notes" value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || !f.source.trim() || (priced && !!price.trim() && parseMoney(price, currency) === null)} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The clinic's schedules (all kinds, or one kind such as its dewormers), with approval and “Apply to patients”. */
export function Protocols({ kind }: { kind?: CareKindWithPrice }) {
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const w = WORDS[kind ?? 'any'];
  const [dlg, setDlg] = useState<{ open: boolean; protocol: CareProtocol | null }>({ open: false, protocol: null });
  const q = useQuery({
    queryKey: ['care-protocols', kind ?? 'all'],
    queryFn: async () => (await api.get<CareProtocol[]>('/care-protocols?all=true')).filter((p) => !kind || p.kind === kind),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVED' | 'RETIRED' | 'apply' }) => (action === 'apply' ? api.post<{ patients: number; created: number }>(`/care-protocols/${id}/apply-all`) : api.post(`/care-protocols/${id}/status`, { status: action })),
    onSuccess: (r: any, v) => { if (v.action === 'apply') toast.success(`Added to ${r.created} care plan(s) (${r.patients} matching patients)`); qc.invalidateQueries({ queryKey: ['care-protocols'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm text-muted-foreground">Only <b>approved</b> {w.one}s can be used — a vet approves each one.</p>
        {can('preventive.write') && <Button size="sm" onClick={() => setDlg({ open: true, protocol: null })}><Plus /> {w.new}</Button>}
      </div>
      <DataTable
        query={q}
        rowKey={(p) => p.id}
        empty={<EmptyState icon={ShieldCheck} title={w.emptyTitle} description={w.emptyText} />}
        columns={[
          { key: 'name', header: kind === 'VACCINATION' ? 'Vaccine' : kind ? 'Dewormer' : 'Protocol', cell: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{enumLabel(p.kind)} · {p.species?.name ?? 'All species'}{p.product ? ` · ${p.product.name}` : ''}</p></div> },
          { key: 'sched', header: 'Schedule', cell: (p) => <span className="text-sm">{[p.firstDueAgeWeeks != null && `first at ${p.firstDueAgeWeeks} wk`, p.intervalDays && `every ${p.intervalDays} days`].filter(Boolean).join(', ')}</span> },
          ...(kind ? [{ key: 'price', header: 'Price', cell: (p: CareProtocol) => (p.service ? <Link href="/settings/services" className="tabular text-sm hover:underline" title={`${p.service.code} in Services & prices`}>{fmtMoney(p.service.priceMinor, currency)}</Link> : <span className="text-xs text-muted-foreground">Product price</span>) }] : []),
          { key: 'source', header: 'Source', cell: (p) => <span className="line-clamp-2 text-xs text-muted-foreground">{p.source}</span> },
          { key: 'st', header: 'Status', cell: (p) => <span><Badge variant={p.status === 'APPROVED' ? 'success' : p.status === 'DRAFT' ? 'warning' : 'secondary'}>{p.status === 'DRAFT' ? 'Needs vet approval' : enumLabel(p.status)}</Badge>{p.reviewedByName && <span className="block text-2xs text-muted-foreground">{p.reviewedByName} · {fmtDate(p.reviewedAt)}</span>}</span> },
          {
            key: 'act',
            header: '',
            cell: (p) =>
              can('preventive.write') && p.status !== 'RETIRED' && (
                <div className="flex justify-end gap-1">
                  {p.status === 'DRAFT' && can('clinical.sign') && <Button size="sm" onClick={() => act.mutate({ id: p.id, action: 'APPROVED' })}><CheckCircle2 /> Approve</Button>}
                  {p.status === 'APPROVED' && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: p.id, action: 'apply' })}><Users /> Apply to patients</Button>}
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setDlg({ open: true, protocol: p })}><Edit /></Button>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: p.id, action: 'RETIRED' })}>Retire</Button>
                </div>
              ),
          },
        ]}
      />
      <ProtocolDialog kind={kind} protocol={dlg.protocol} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </Card>
  );
}

/** What is due and overdue (all kinds, or one kind such as deworming), with Remind and Book. */
export function Worklist({ kind }: { kind?: 'DEWORMING' | 'VACCINATION' }) {
  const url = useUrlState();
  const { can } = useSession();
  const params = { range: url.get('range', 'week'), kind: kind ?? url.get('kind'), page: Number(url.get('page', '1')), pageSize: 50 };
  const q = useQuery({ queryKey: ['care-items', params], queryFn: () => api.get<Paginated<CareItem>>(`/care-items${qs(params)}`), placeholderData: (p) => p });
  const remind = useMutation({
    mutationFn: (id: string) => api.post<{ status: string }>(`/care-items/${id}/remind`),
    onSuccess: (r) => toast.success(r.status === 'OPTED_OUT' ? 'The owner has opted out of reminders' : r.status === 'SKIPPED' ? 'Not sent: no provider or contact for the preferred channel' : 'Reminder queued'),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1" role="tablist">
          {[['overdue', 'Overdue'], ['week', 'Due within 7 days'], ['month', 'Due within 31 days'], ['all', 'All open']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={params.range === k} onClick={() => url.set({ range: k, page: 1 })} className={cn('rounded-md px-3 py-1.5 text-sm', params.range === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{l}</button>
          ))}
        </div>
        {!kind && (
          <NativeSelect aria-label="Type" className="sm:ml-auto sm:w-56" value={params.kind} onChange={(e) => url.set({ kind: e.target.value, page: 1 })}>
            <option value="">All types</option>
            {CARE_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}
          </NativeSelect>
        )}
      </div>
      <DataTable
        query={q}
        rowKey={(i) => i.id}
        page={params.page}
        pageSize={50}
        onPage={(page) => url.set({ page })}
        empty={<EmptyState icon={CheckCircle2} title="Nothing in this list" />}
        columns={[
          { key: 'due', header: 'Due', cell: (i) => <span className={cn('whitespace-nowrap text-sm', i.overdue && 'font-semibold text-destructive')}>{fmtDate(i.effectiveDueDate)}</span> },
          { key: 'pet', header: 'Patient', cell: (i) => <Link className="text-sm font-medium hover:underline" href={`/patients/${i.patient?.id}?tab=care`}>{i.patient?.name} <span className="font-normal text-muted-foreground">· {i.patient?.species.name}</span></Link> },
          { key: 'what', header: 'Care', cell: (i) => <div><span className="text-sm">{i.title}</span><RepeatNote item={i} /></div> },
          { key: 'owner', header: 'Owner', cell: (i) => (i.owner ? <span className="text-sm"><Link className="hover:underline" href={`/clients/${i.owner.id}`}>{i.owner.displayName}</Link><span className="block text-xs text-muted-foreground">{i.owner.mobilePhone ?? i.owner.email ?? 'no contact'}{!i.owner.remindersConsent && ' · opted out'}</span></span> : '—') },
          { key: 'rem', header: 'Reminded', cell: (i) => <span className="text-xs text-muted-foreground">{i.overdueRemindedAt ? `Overdue notice ${fmtDate(i.overdueRemindedAt)}` : i.remindedAt ? fmtDate(i.remindedAt) : '—'}</span> },
          { key: 'st', header: 'Status', cell: (i) => <CareStatusBadge item={i} /> },
          {
            key: 'act',
            header: '',
            cell: (i) => (
              <div className="flex justify-end gap-1">
                {can('communications.send') && i.owner?.remindersConsent && <Button size="sm" variant="ghost" loading={remind.isPending && remind.variables === i.id} onClick={() => remind.mutate(i.id)}><BellRing /> Remind</Button>}
                {/* The client said yes: book it with the patient and the reason already filled in. */}
                {can('appointments.write') && (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/calendar?book=1&patient=${i.patientId}&reason=${encodeURIComponent(i.title)}${i.kind === 'VACCINATION' ? '&type=VACCINATION' : ''}`}><CalendarPlus /> Book</Link>
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

