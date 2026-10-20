'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { CheckCircle2, MapPin, Package, Play, Plus, Receipt, Stethoscope, Syringe, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { VisitStatusBadge } from '@/components/livestock/badges';
import { GroupTreatmentDialog } from '@/components/livestock/record-dialogs';
import { DescriptionList, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/pharmacy/product-picker';
import { RequirePermission } from '@/components/require';
import { AttachmentsPanel } from '@/components/shared/attachments-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { FarmDetail, FieldVisitDetail, GroupDetail, Invoice, Product, Service } from '@/lib/types';

function AddItemDialog({ open, onOpenChange, visit, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; visit: FieldVisitDetail; onDone: () => void }) {
  const { currency } = useSession();
  const [mode, setMode] = useState<'service' | 'product'>('service');
  const [serviceId, setServiceId] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [patientId, setPatientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const farm = useQuery({ queryKey: ['farm', visit.farmId], queryFn: () => api.get<FarmDetail>(`/farms/${visit.farmId}`), enabled: open });
  const animals = useQuery({
    queryKey: ['farm-animals', visit.farmId],
    queryFn: async () => (await Promise.all((farm.data?.groups ?? []).filter((g) => g.tracksIndividuals).map((g) => api.get<GroupDetail>(`/animal-groups/${g.id}`)))).flatMap((g) => g.animals),
    enabled: open && !!farm.data,
  });
  useEffect(() => { if (open) { setError(null); setServiceId(''); setProduct(null); setQuantity('1'); setPatientId(''); } }, [open]);
  const m = useMutation({
    mutationFn: () => api.post(`/field-visits/${visit.id}/items`, { serviceId: mode === 'service' ? serviceId : null, productId: mode === 'product' ? product?.id : null, quantity, patientId: patientId || null }),
    onSuccess: () => { toast.success('Added and billed to the client'); onOpenChange(false); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  const svc = services.data?.find((s) => s.id === serviceId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add work or medicine</DialogTitle><DialogDescription>Each item is billed to {visit.client.displayName}. Medicines are taken from stock.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <div className="flex gap-1">
            <Button size="sm" variant={mode === 'service' ? 'default' : 'outline'} onClick={() => setMode('service')}><Stethoscope /> Service</Button>
            <Button size="sm" variant={mode === 'product' ? 'default' : 'outline'} onClick={() => setMode('product')}><Package /> Medicine / product</Button>
          </div>
          {mode === 'service' ? (
            <Field label="Service" htmlFor="vi-svc" required hint={svc ? `${fmtMoney(svc.priceMinor, currency)} each` : undefined}>
              <NativeSelect id="vi-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)}><option value="">Choose…</option>{(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
            </Field>
          ) : (
            <Field label="Product" htmlFor="vi-prod" required hint={product ? `${product.sellPriceMinor ? fmtMoney(product.sellPriceMinor, currency) : 'No price'} per ${product.dispensingUnit}` : undefined}><ProductPicker id="vi-prod" value={product} onChange={setProduct} /></Field>
          )}
          <Field label="Quantity" htmlFor="vi-qty" required><Input id="vi-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
          <Field label="For animal (optional)" htmlFor="vi-animal" hint={mode === 'product' ? 'Records the withdrawal period on that animal if one is configured.' : undefined}>
            <NativeSelect id="vi-animal" value={patientId} onChange={(e) => setPatientId(e.target.value)}><option value="">Whole farm / not specific</option>{(animals.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.tag && a.tag !== a.name ? ` (${a.tag})` : ''}</option>)}</NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Number(quantity) || (mode === 'service' ? !serviceId : !product)} onClick={() => { setError(null); m.mutate(); }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ open, onOpenChange, visit, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; visit: FieldVisitDetail; onDone: () => void }) {
  const [f, setF] = useState({ findings: '', recommendations: '', distanceKm: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setF({ findings: visit.findings ?? '', recommendations: visit.recommendations ?? '', distanceKm: visit.distanceKm?.toString() ?? '' }); } }, [open, visit]);
  const m = useMutation({
    mutationFn: () => api.post(`/field-visits/${visit.id}/complete`, { ...f, distanceKm: f.distanceKm || null }),
    onSuccess: () => { toast.success('Visit completed'); onOpenChange(false); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Complete visit</DialogTitle><DialogDescription>The visit record is locked once completed. The call-out fee is added to the owner’s charges.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3">
          <Field label="Findings" htmlFor="fc-find" required><Textarea id="fc-find" rows={5} value={f.findings} maxLength={10000} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
          <Field label="Recommendations for the farmer" htmlFor="fc-rec"><Textarea id="fc-rec" rows={4} value={f.recommendations} maxLength={10000} onChange={(e) => setF({ ...f, recommendations: e.target.value })} /></Field>
          <Field label="Distance travelled (km)" htmlFor="fc-km"><Input id="fc-km" inputMode="decimal" className="w-32" value={f.distanceKm} onChange={(e) => setF({ ...f, distanceKm: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.findings.trim()} onClick={() => { setError(null); m.mutate(); }}>Complete visit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Visit() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, currency } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<null | 'item' | 'treat' | 'complete'>(null);
  const q = useQuery({ queryKey: ['field-visit', id], queryFn: () => api.get<FieldVisitDetail>(`/field-visits/${id}`) });
  const farm = useQuery({ queryKey: ['farm', q.data?.farmId], queryFn: () => api.get<FarmDetail>(`/farms/${q.data!.farmId}`), enabled: !!q.data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['field-visit', id] }); qc.invalidateQueries({ queryKey: ['field-visits'] }); };
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: 'start' | 'cancel'; reason?: string }) => api.post(`/field-visits/${id}/${action}`, action === 'cancel' ? { reason } : {}),
    onSuccess: (_d, v) => { toast.success(v.action === 'start' ? 'Visit started' : 'Visit cancelled'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const invoice = useMutation({
    mutationFn: (chargeIds: string[]) => api.post<Invoice>('/invoices', { clientId: q.data!.client.id, chargeIds, lines: [], notes: `Field visit ${q.data!.visitNo}` }),
    onSuccess: (inv) => { toast.success('Draft invoice created'); router.push(`/billing/invoices/${inv.id}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;
  const canWrite = can('livestock.write');
  const openVisit = v.status === 'SCHEDULED' || v.status === 'IN_PROGRESS';
  const pending = v.charges.filter((c) => c.status === 'PENDING');
  const total = v.charges.filter((c) => c.status !== 'WAIVED').reduce((n, c) => n + c.totalMinor, 0);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Livestock & farms', href: '/livestock?tab=visits' }, { label: v.farm.name, href: `/livestock/farms/${v.farm.id}` }, { label: v.visitNo }]}
        title={<span className="flex items-center gap-2">Field visit <VisitStatusBadge status={v.status} /></span>}
        help="livestock"
        description={`${v.purpose} · ${fmtDateTime(v.scheduledAt)}${v.clinician ? ` · ${v.clinician.name}` : ''}`}
        actions={
          canWrite && openVisit && (
            <>
              {!v.items.length && !v.treatments.length && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Cancel this visit?', description: 'The visit stays on record as cancelled. No call-out fee is charged.', confirmLabel: 'Cancel visit', cancelLabel: 'Keep visit', destructive: true, requireReason: true }); if (c.confirmed) act.mutate({ action: 'cancel', reason: c.reason }); }}><XCircle /> Cancel visit</Button>}
              {/* Until the visit is under way, starting it is the next step; completing comes after. */}
              {v.status === 'SCHEDULED' && <Button size="sm" loading={act.isPending && act.variables?.action === 'start'} onClick={() => act.mutate({ action: 'start' })}><Play /> Start visit</Button>}
              <Button size="sm" variant={v.status === 'SCHEDULED' ? 'outline' : 'default'} onClick={() => setDialog('complete')}><CheckCircle2 /> Complete visit</Button>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Work and medicines</CardTitle>
              {canWrite && openVisit && (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDialog('treat')}><Syringe /> Treat a group</Button>
                  <Button size="sm" onClick={() => setDialog('item')}><Plus /> Add item</Button>
                </span>
              )}
            </CardHeader>
            {v.items.length || v.treatments.length ? (
              <ul className="divide-y text-sm">
                {v.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                    {i.kind === 'SERVICE' ? <Stethoscope className="h-4 w-4 text-muted-foreground" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                    <span className="flex-1">{i.description}{i.patient && <span className="text-muted-foreground"> — {i.patient.name}</span>}</span>
                    <span className="tabular text-muted-foreground">{fmtNumber(i.quantity)} × {fmtMoney(i.unitPriceMinor, currency)}</span>
                  </li>
                ))}
                {v.treatments.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <Syringe className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{t.productName} — {enumLabel(t.kind).toLowerCase()} of {fmtNumber(t.headCount)} head{t.group ? ` (${t.group.name})` : ''}</span>
                    {t.quantityIssued != null && <span className="tabular text-muted-foreground">{fmtNumber(t.quantityIssued)} used</span>}
                  </li>
                ))}
              </ul>
            ) : <CardContent><p className="text-sm text-muted-foreground">Nothing recorded yet. Add services, medicines or group treatments as you work.</p></CardContent>}
          </Card>
          {(v.findings || v.recommendations) && (
            <Card>
              <CardHeader><CardTitle>Findings</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {v.findings && <p className="whitespace-pre-wrap">{v.findings}</p>}
                {v.recommendations && <div><p className="text-xs font-medium text-muted-foreground">Recommendations</p><p className="whitespace-pre-wrap">{v.recommendations}</p></div>}
                {v.completedAt && <p className="text-xs text-muted-foreground">Completed {fmtDateTime(v.completedAt)} by {v.completedByName}</p>}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Documents & photos</CardTitle></CardHeader>
            <CardContent><AttachmentsPanel entityType="FieldVisit" entityId={v.id} canWrite={canWrite} /></CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Farm</CardTitle></CardHeader>
            <CardContent>
              <DescriptionList items={[
                { label: 'Farm', value: <Link href={`/livestock/farms/${v.farm.id}`} className="hover:underline">{v.farm.name}</Link> },
                { label: 'Owner', value: <Link href={`/clients/${v.client.id}`} className="hover:underline">{v.client.displayName}</Link> },
                { label: 'Phone', value: v.client.mobilePhone ?? '—' },
                { label: 'Address', value: v.farm.address ?? v.farm.district ?? '—' },
                { label: 'Distance', value: v.distanceKm != null ? `${v.distanceKm} km` : '—' },
              ]} />
              {v.farm.latitude != null && v.farm.longitude != null && <a className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${v.farm.latitude}&mlon=${v.farm.longitude}#map=15/${v.farm.latitude}/${v.farm.longitude}`}><MapPin className="h-4 w-4" /> Open map</a>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm">
              {v.charges.length ? v.charges.map((c) => (
                <div key={c.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{c.description}</span><span className="tabular">{fmtMoney(c.totalMinor, currency)}</span></div>
              )) : <p className="text-muted-foreground">No charges yet.{v.calloutServiceId && openVisit ? ' The call-out fee is added on completion.' : ''}</p>}
              {!!v.charges.length && <div className="flex justify-between border-t pt-2 font-medium"><span>Total (before tax)</span><span className="tabular">{fmtMoney(total, currency)}</span></div>}
              {can('billing.write') && pending.length > 0 && <Button size="sm" className="mt-2" loading={invoice.isPending} onClick={() => invoice.mutate(pending.map((c) => c.id))}><Receipt /> Invoice {pending.length} {pending.length === 1 ? 'item' : 'items'}</Button>}
              {pending.length === 0 && v.charges.length > 0 && <p className="text-xs text-muted-foreground">All charges are invoiced.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
      <AddItemDialog open={dialog === 'item'} onOpenChange={(o) => !o && setDialog(null)} visit={v} onDone={refresh} />
      <CompleteDialog open={dialog === 'complete'} onOpenChange={(o) => !o && setDialog(null)} visit={v} onDone={refresh} />
      <GroupTreatmentDialog open={dialog === 'treat'} onOpenChange={(o) => !o && setDialog(null)} farmId={v.farmId} groups={farm.data?.groups ?? []} fieldVisitId={v.id} onDone={refresh} />
    </>
  );
}

export default function VisitPage() {
  return (
    <RequirePermission anyOf={['livestock.read']}>
      <Suspense>
        <Visit />
      </Suspense>
    </RequirePermission>
  );
}
