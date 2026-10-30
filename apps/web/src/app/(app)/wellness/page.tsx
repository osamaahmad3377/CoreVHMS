'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Archive, ArchiveRestore, CalendarClock, Edit, HeartHandshake, Plus, Receipt, Repeat, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { bpToPct } from '@/components/billing/money';
import { useConfirm } from '@/components/confirm';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { SearchInput } from '@/components/search-input';
import { Stat } from '@/components/stat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { WellnessStateBadge } from '@/components/wellness/membership';
import { PlanEditor } from '@/components/wellness/plan-editor';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { WellnessMember, WellnessOverview, WellnessPlan } from '@/lib/types';
import { cn } from '@/lib/utils';

const FILTERS = [
  ['ACTIVE', 'Active'],
  ['ENDING', 'Ending in 30 days'],
  ['UPCOMING', 'Starting soon'],
  ['EXPIRED', 'Ended'],
  ['CANCELLED', 'Cancelled'],
  ['ALL', 'All'],
] as const;

function Members() {
  const { currency } = useSession();
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>('ACTIVE');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['wellness-members', status, term, page], queryFn: () => api.get<Paginated<WellnessMember>>(`/wellness/members${qs({ status, q: term || undefined, page, pageSize: 25 })}`) });
  const rows = q.data?.data ?? [];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.meta.total / q.data.meta.pageSize)) : 1;
  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Members">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setPage(1); }} className={cn('rounded-pill px-3 py-1 text-xs font-medium transition-colors', status === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        <SearchInput value={term} onChange={(v) => { setTerm(v); setPage(1); }} placeholder="Patient, owner or WP number" className="lg:w-72" />
      </div>
      {q.isLoading ? (
        <LoadingRows />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={Users} title="No members here" description={status === 'ACTIVE' ? 'Enrol a patient from their record: open the patient, then the Wellness tab.' : 'Nothing matches this filter.'} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Patient</TH>
                <TH>Plan</TH>
                <TH className="hidden md:table-cell">Term</TH>
                <TH className="hidden lg:table-cell">Used</TH>
                <TH className="hidden lg:table-cell text-right">Saved</TH>
                <TH className="hidden md:table-cell">Next payment</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <Link href={`/patients/${m.patient.id}?tab=wellness`} className="font-medium text-primary hover:underline">{m.patient.name}</Link>
                    <p className="text-xs text-muted-foreground">{m.patient.species.name} · {m.client.displayName}</p>
                  </TD>
                  <TD>
                    <p>{m.planName}</p>
                    <p className="text-xs text-muted-foreground">{m.enrolmentNo} · {m.billing === 'MONTHLY' ? 'monthly' : 'up front'}</p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-sm md:table-cell">
                    {fmtDate(m.startDate)} – {fmtDate(m.endDate)}
                    {m.state === 'ACTIVE' && m.daysLeft != null && <p className={cn('text-xs', m.daysLeft <= 30 ? 'font-medium text-warning' : 'text-muted-foreground')}>{m.daysLeft} days left</p>}
                  </TD>
                  <TD className="hidden text-sm lg:table-cell">{m.includedTotal ? `${m.includedUsed} of ${m.includedTotal}` : '—'}</TD>
                  <TD className="hidden text-right tabular text-success lg:table-cell">{fmtMoney(m.savedMinor, currency)}</TD>
                  <TD className="hidden text-sm md:table-cell">{m.nextPayment && m.status === 'ACTIVE' ? <>{fmtMoney(m.nextPayment.amountMinor, currency)} <span className="text-xs text-muted-foreground">{fmtDate(m.nextPayment.dueDate)}</span></> : '—'}</TD>
                  <TD><WellnessStateBadge state={m.state} autoRenew={m.autoRenew} renewed={!!m.renewedTo} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Plans() {
  const { currency, can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<WellnessPlan | null | 'new'>(null);
  const q = useQuery({ queryKey: ['wellness-plans', 'all'], queryFn: () => api.get<WellnessPlan[]>('/wellness/plans?all=true') });
  const status = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'RETIRED' }) => api.post<WellnessPlan>(`/wellness/plans/${id}/status`, { status }),
    onSuccess: (p) => {
      toast.success(p.status === 'RETIRED' ? `${p.name} is no longer offered` : `${p.name} is offered again`);
      qc.invalidateQueries({ queryKey: ['wellness-plans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const manage = can('wellness.manage');
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const plans = q.data ?? [];
  return (
    <div className="grid gap-4">
      {manage && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}><Plus /> New plan</Button>
        </div>
      )}
      {!plans.length ? (
        <Card>
          <EmptyState icon={HeartHandshake} title="No wellness plans yet" description="Create a plan — for example “Adult Dog Gold”: two check-ups, yearly vaccines and a dental clean for a year, with 10% off everything else." action={manage ? <Button onClick={() => setEditing('new')}><Plus /> New plan</Button> : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className={cn('flex flex-col', p.status === 'RETIRED' && 'opacity-70')}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {p.name}
                    {p.status === 'RETIRED' && <Badge variant="secondary">Not offered</Badge>}
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.species?.name ?? 'Any species'} · {p.durationMonths} months · {p.activeMembers} active member{p.activeMembers === 1 ? '' : 's'}</p>
                </div>
              </CardHeader>
              <div className="grid flex-1 content-start gap-3 border-t p-4 text-sm">
                <p>
                  <span className="text-xl font-semibold tabular">{fmtMoney(p.priceMinor, currency)}</span>
                  <span className="text-muted-foreground"> up front</span>
                  {p.monthlyPriceMinor != null && <span className="text-muted-foreground"> · or {fmtMoney(p.monthlyPriceMinor, currency)}/month</span>}
                </p>
                {p.joiningFeeMinor > 0 && <p className="text-xs text-muted-foreground">Joining fee {fmtMoney(p.joiningFeeMinor, currency)}</p>}
                {p.description && <p className="text-muted-foreground">{p.description}</p>}
                <ul className="grid gap-1">
                  {p.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span>✓ {i.quantity} × {i.label}{i.unavailable && <span className="text-xs text-warning"> (switched off)</span>}</span>
                      <span className="tabular text-xs text-muted-foreground">{fmtMoney(i.unitValueMinor * i.quantity, currency)}</span>
                    </li>
                  ))}
                </ul>
                {(p.serviceDiscountBp > 0 || p.productDiscountBp > 0) && (
                  <p className="text-success">{[p.serviceDiscountBp > 0 && `${bpToPct(p.serviceDiscountBp)} off services`, p.productDiscountBp > 0 && `${bpToPct(p.productDiscountBp)} off products`].filter(Boolean).join(' · ')}</p>
                )}
                {p.includedValueMinor > p.priceMinor && <p className="text-xs text-muted-foreground">Included items worth {fmtMoney(p.includedValueMinor, currency)} — members save {fmtMoney(p.includedValueMinor - p.priceMinor, currency)}</p>}
              </div>
              {manage && (
                <div className="flex justify-end gap-2 border-t p-3">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Edit /> Edit</Button>
                  {p.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        const r = await confirm({ title: `Stop offering ${p.name}?`, description: 'Current members keep their plan until it ends. It can’t be chosen for new members or renewals.', confirmLabel: 'Stop offering' });
                        if (r.confirmed) status.mutate({ id: p.id, status: 'RETIRED' });
                      }}
                    >
                      <Archive /> Stop offering
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => status.mutate({ id: p.id, status: 'ACTIVE' })}><ArchiveRestore /> Offer again</Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <PlanEditor plan={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}

function WellnessView() {
  const { currency, can } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') === 'plans' ? 'plans' : 'members';
  const o = useQuery({ queryKey: ['wellness-overview'], queryFn: () => api.get<WellnessOverview>('/wellness/overview') });
  const bill = useMutation({
    mutationFn: () => api.post<{ billed: number }>('/wellness/bill-due'),
    onSuccess: (r) => {
      toast.success(r.billed ? `${r.billed} payment(s) added to clients’ bills` : 'Nothing due to bill');
      qc.invalidateQueries({ queryKey: ['wellness-overview'] });
      qc.invalidateQueries({ queryKey: ['wellness-members'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = o.data;
  return (
    <>
      <PageHeader
        title="Wellness plans"
        description="Care packages paid up front or monthly. Included items and member discounts come off the bill automatically."
        help="wellness"
        actions={
          can('wellness.enrol') && !!d?.paymentsToBill && (
            <Button variant="outline" loading={bill.isPending} onClick={() => bill.mutate()} title="Monthly payments are billed automatically every hour; this bills them now">
              <Receipt /> Bill {d.paymentsToBill} payment{d.paymentsToBill === 1 ? '' : 's'} due
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active members" value={d?.activeMembers ?? '—'} icon={Users} />
        <Stat label="Ending in 30 days" value={d?.endingSoon ?? '—'} icon={CalendarClock} tone={d?.endingSoon ? 'warning' : 'default'} hint="Not yet renewed" />
        <Stat label="Monthly payments" value={d ? fmtMoney(d.monthlyRecurringMinor, currency) : '—'} icon={Repeat} hint="Each month, from members paying monthly" />
        <Stat label="Saved by members this month" value={d ? fmtMoney(d.savedThisMonthMinor, currency) : '—'} icon={Sparkles} tone="success" />
      </div>
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Wellness">
        {(
          [
            ['members', 'Members'],
            ['plans', 'Plans'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(k === 'plans' ? '/wellness?tab=plans' : '/wellness')} className={cn('rounded-pill px-4 py-1.5 text-sm font-medium transition-colors', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'members' ? <Members /> : <Plans />}
    </>
  );
}

export default function WellnessPage() {
  return (
    <RequirePermission anyOf={['wellness.read', 'wellness.manage']}>
      <Suspense fallback={<LoadingRows />}>
        <WellnessView />
      </Suspense>
    </RequirePermission>
  );
}
