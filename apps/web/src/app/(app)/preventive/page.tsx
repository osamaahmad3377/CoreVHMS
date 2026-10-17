'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CARE_KINDS, enumLabel, type Paginated } from '@vcms/shared';
import { BellRing, CheckCircle2, Edit, Plus, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { ProductPicker } from '@/components/pharmacy/product-picker';
import { CareStatusBadge } from '@/components/preventive/care-plan';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CareItem, CareProtocol, Product } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Species { id: string; name: string }

function ProtocolDialog({ protocol, open, onOpenChange }: { protocol: CareProtocol | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), enabled: open });
  const [f, setF] = useState({ name: '', kind: 'VACCINATION', speciesId: '', firstDueAgeWeeks: '', intervalDays: '', source: '', notes: '' });
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(protocol ? { name: protocol.name, kind: protocol.kind, speciesId: protocol.speciesId ?? '', firstDueAgeWeeks: protocol.firstDueAgeWeeks?.toString() ?? '', intervalDays: protocol.intervalDays?.toString() ?? '', source: protocol.source, notes: protocol.notes ?? '' } : { name: '', kind: 'VACCINATION', speciesId: '', firstDueAgeWeeks: '', intervalDays: '', source: '', notes: '' });
    setProduct(protocol?.product ? ({ ...protocol.product } as Product) : null);
  }, [open, protocol]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => {
      const body = { ...f, speciesId: f.speciesId || null, productId: product?.id ?? null, firstDueAgeWeeks: f.firstDueAgeWeeks || null, intervalDays: f.intervalDays || null, notes: f.notes || null };
      return protocol ? api.patch(`/care-protocols/${protocol.id}`, body) : api.post('/care-protocols', body);
    },
    onSuccess: () => { toast.success('Protocol saved — a vet must approve it before it is used'); qc.invalidateQueries({ queryKey: ['care-protocols'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{protocol ? `Edit ${protocol.name}` : 'New care protocol'}</DialogTitle>
          <DialogDescription>Schedules come from your clinic’s veterinary guidance — the system ships none. Record where the schedule comes from; a vet approves it before it is applied to patients.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="cp-name" required className="sm:col-span-2"><Input id="cp-name" value={f.name} maxLength={120} onChange={set('name')} placeholder="e.g. Canine core vaccination — annual booster" /></Field>
          <Field label="Type" htmlFor="cp-kind"><NativeSelect id="cp-kind" value={f.kind} onChange={set('kind')}>{CARE_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}</NativeSelect></Field>
          <Field label="Species" htmlFor="cp-species"><NativeSelect id="cp-species" value={f.speciesId} onChange={set('speciesId')}><option value="">All species</option>{(species.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
          <Field label="First due at age (weeks)" htmlFor="cp-age" hint="Optional: for young animals"><Input id="cp-age" inputMode="numeric" value={f.firstDueAgeWeeks} onChange={set('firstDueAgeWeeks')} /></Field>
          <Field label="Repeat every (days)" htmlFor="cp-int" hint="Empty = one-off"><Input id="cp-int" inputMode="numeric" value={f.intervalDays} onChange={set('intervalDays')} /></Field>
          <Field label="Product (optional)" htmlFor="cp-prod" hint="Giving this product completes the item automatically" className="sm:col-span-2"><ProductPicker id="cp-prod" value={product} onChange={setProduct} prescribable /></Field>
          <Field label="Source / guideline" htmlFor="cp-source" required className="sm:col-span-2" hint="e.g. the guideline, manufacturer datasheet or practice policy this schedule follows"><Input id="cp-source" value={f.source} maxLength={500} onChange={set('source')} /></Field>
          <Field label="Notes" htmlFor="cp-notes" className="sm:col-span-2"><Textarea id="cp-notes" value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || !f.source.trim()} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Protocols() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [dlg, setDlg] = useState<{ open: boolean; protocol: CareProtocol | null }>({ open: false, protocol: null });
  const q = useQuery({ queryKey: ['care-protocols'], queryFn: () => api.get<CareProtocol[]>('/care-protocols?all=true') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'APPROVED' | 'RETIRED' | 'apply' }) => (action === 'apply' ? api.post<{ patients: number; created: number }>(`/care-protocols/${id}/apply-all`) : api.post(`/care-protocols/${id}/status`, { status: action })),
    onSuccess: (r: any, v) => { if (v.action === 'apply') toast.success(`Added to ${r.created} care plan(s) (${r.patients} matching patients)`); qc.invalidateQueries({ queryKey: ['care-protocols'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm text-muted-foreground">Only <b>approved</b> protocols create care-plan items and reminders.</p>
        {can('preventive.write') && <Button size="sm" onClick={() => setDlg({ open: true, protocol: null })}><Plus /> New protocol</Button>}
      </div>
      <DataTable
        query={q}
        rowKey={(p) => p.id}
        empty={<EmptyState icon={ShieldCheck} title="No protocols yet" description="Add your clinic’s vaccination, parasite-control and health-check schedules." />}
        columns={[
          { key: 'name', header: 'Protocol', cell: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{enumLabel(p.kind)} · {p.species?.name ?? 'All species'}{p.product ? ` · ${p.product.name}` : ''}</p></div> },
          { key: 'sched', header: 'Schedule', cell: (p) => <span className="text-sm">{[p.firstDueAgeWeeks != null && `first at ${p.firstDueAgeWeeks} wk`, p.intervalDays && `every ${p.intervalDays} days`].filter(Boolean).join(', ')}</span> },
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
      <ProtocolDialog protocol={dlg.protocol} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </Card>
  );
}

function Worklist() {
  const url = useUrlState();
  const { can } = useSession();
  const params = { range: url.get('range', 'week'), kind: url.get('kind'), page: Number(url.get('page', '1')), pageSize: 50 };
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
        <NativeSelect aria-label="Type" className="sm:ml-auto sm:w-56" value={params.kind} onChange={(e) => url.set({ kind: e.target.value, page: 1 })}>
          <option value="">All types</option>
          {CARE_KINDS.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}
        </NativeSelect>
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
          { key: 'what', header: 'Care', cell: (i) => <span className="text-sm">{i.title}</span> },
          { key: 'owner', header: 'Owner', cell: (i) => (i.owner ? <span className="text-sm"><Link className="hover:underline" href={`/clients/${i.owner.id}`}>{i.owner.displayName}</Link><span className="block text-xs text-muted-foreground">{i.owner.mobilePhone ?? i.owner.email ?? 'no contact'}{!i.owner.remindersConsent && ' · opted out'}</span></span> : '—') },
          { key: 'rem', header: 'Reminded', cell: (i) => <span className="text-xs text-muted-foreground">{i.overdueRemindedAt ? `Overdue notice ${fmtDate(i.overdueRemindedAt)}` : i.remindedAt ? fmtDate(i.remindedAt) : '—'}</span> },
          { key: 'st', header: 'Status', cell: (i) => <CareStatusBadge item={i} /> },
          { key: 'act', header: '', cell: (i) => can('communications.send') && i.owner?.remindersConsent && <Button size="sm" variant="ghost" loading={remind.isPending && remind.variables === i.id} onClick={() => remind.mutate(i.id)}><BellRing /> Remind</Button> },
        ]}
      />
    </Card>
  );
}

interface ComplianceRow { protocolId: string; name: string; kind: string; species: string; patientsInScope: number; inPlan: number; upToDate: number; overdue: number; notInPlan: number; compliancePercent: number | null }

function Compliance() {
  const q = useQuery({ queryKey: ['compliance'], queryFn: () => api.get<ComplianceRow[]>('/preventive/compliance') });
  return (
    <Card>
      {q.data?.length ? (
        <Table>
          <THead><TR><TH>Protocol</TH><TH className="text-right">Active patients</TH><TH className="text-right">Up to date</TH><TH className="text-right">Overdue</TH><TH className="text-right">Not in a plan</TH><TH className="text-right">Compliance</TH></TR></THead>
          <TBody>
            {q.data.map((r) => (
              <TR key={r.protocolId}>
                <TD><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{enumLabel(r.kind)} · {r.species}</p></TD>
                <TD className="text-right tabular">{r.patientsInScope}</TD>
                <TD className="text-right tabular text-success">{r.upToDate}</TD>
                <TD className={cn('text-right tabular', r.overdue && 'font-semibold text-destructive')}>{r.overdue}</TD>
                <TD className="text-right tabular text-muted-foreground">{r.notInPlan}</TD>
                <TD className="text-right"><span className="font-semibold tabular">{r.compliancePercent ?? '—'}{r.compliancePercent != null && '%'}</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <EmptyState title="No approved protocols yet" description="Compliance is measured against your approved protocols." />}
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">Up to date = in the care plan and not overdue. “Not in a plan” patients can be added with Apply to patients on the Protocols tab.</p>
    </Card>
  );
}

function Preventive() {
  const url = useUrlState();
  const tab = url.get('tab', 'due');
  return (
    <>
      <PageHeader title="Vaccines & reminders" help="preventive" description="Vaccinations, parasite control and health checks — what is due, who to remind, and how well patients are covered." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {[['due', 'Due & overdue'], ['protocols', 'Protocols'], ['compliance', 'Compliance']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => url.set({ tab: k })} className={cn('-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{l}</button>
        ))}
      </div>
      {tab === 'protocols' ? <Protocols /> : tab === 'compliance' ? <Compliance /> : <Worklist />}
    </>
  );
}

export default function PreventivePage() {
  return (
    <RequirePermission anyOf={['preventive.read']}>
      <Suspense><Preventive /></Suspense>
    </RequirePermission>
  );
}
