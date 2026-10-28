'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STORAGE_PACK_GB, daysLeft, type PlanRequestView, type PlatformClinic, type PlatformPlan } from '@vcms/shared';
import { ArrowRight, BadgeCheck, Check, Clock, Gift, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { planPrice } from './plan-ui';

/** "1 extra branch", "2 extra staff accounts", "Professional plan". */
export function requestText(r: Pick<PlanRequestView, 'kind' | 'quantity' | 'toPlanName'>) {
  if (r.kind === 'PLAN') return `the ${r.toPlanName} plan`;
  if (r.kind === 'EXTRA_STORAGE') return `${r.quantity * STORAGE_PACK_GB} GB more file storage`;
  const branch = r.kind === 'EXTRA_BRANCH';
  return `${r.quantity} extra ${branch ? (r.quantity === 1 ? 'branch' : 'branches') : r.quantity === 1 ? 'staff account' : 'staff accounts'}`;
}

/**
 * Clinic owners' requests to change plan (from Settings → Your plan). Approving moves the clinic to the plan
 * within seconds and emails the owner; dismissing closes the request without changing anything.
 */
export function PlanRequests() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['platform-plan-requests'], queryFn: () => api.get<PlanRequestView[]>('/platform/plan-requests'), refetchInterval: 60_000 });
  const done = () => {
    qc.invalidateQueries({ queryKey: ['platform-plan-requests'] });
    qc.invalidateQueries({ queryKey: ['platform-clinics'] });
    qc.invalidateQueries({ queryKey: ['platform-plans'] });
  };
  const approve = useMutation({
    mutationFn: (r: PlanRequestView) => api.post(`/platform/plan-requests/${r.id}/approve`, {}),
    onSuccess: (_, r) => { toast.success(`${r.clinicName}: ${requestText(r)} approved. The owner has been emailed.`); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const dismiss = useMutation({
    mutationFn: (r: PlanRequestView) => api.post(`/platform/plan-requests/${r.id}/dismiss`, {}),
    onSuccess: (_, r) => { toast.success(`Request from ${r.clinicName} dismissed`); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-warning/[0.08] px-4 py-3">
        <Clock className="h-4 w-4 text-warning" aria-hidden />
        <h2 className="text-sm font-semibold">Plan requests</h2>
        <span className="rounded-pill bg-warning/20 px-2 py-0.5 text-2xs font-semibold">{rows.length}</span>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">Approve once the clinic has paid or agreed the new price.</p>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-64">
              <p className="font-medium">
                <Link href={`/platform/clinics/${r.clinicId}`} className="text-primary hover:underline">{r.clinicName}</Link>
                <span className="ml-2 inline-flex flex-wrap items-center gap-1 text-sm font-normal">
                  {r.kind === 'PLAN' ? (
                    <>
                      <span className="text-muted-foreground">{r.fromPlanName ?? 'No plan'}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="to" />
                      <b>{r.toPlanName}</b>
                    </>
                  ) : (
                    <b>{requestText(r)}</b>
                  )}
                  <span className="text-muted-foreground">· {r.kind === 'PLAN' ? '' : '+'}{planPrice({ priceMonthlyMinor: r.priceMonthlyMinor, currency: r.currency })} / month</span>
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.requestedByName ? `${r.requestedByName} · ` : ''}{fmtDate(r.createdAt)}{r.note ? ` · “${r.note}”` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={approve.isPending && approve.variables?.id === r.id}
                onClick={async () => {
                  const c = await confirm(
                    r.kind === 'PLAN'
                      ? { title: `Move ${r.clinicName} to ${r.toPlanName}?`, description: `The clinic gets the ${r.toPlanName} plan within seconds and the owner is emailed. Its own exceptions (extra staff, branches or features) are kept.`, confirmLabel: 'Approve' }
                      : { title: `Give ${r.clinicName} ${requestText(r)}?`, description: `Its limit goes up straight away and ${planPrice({ priceMonthlyMinor: r.priceMonthlyMinor, currency: r.currency })} is added to its monthly bill. The owner is emailed.`, confirmLabel: 'Approve' },
                  );
                  if (c.confirmed) approve.mutate(r);
                }}
              >
                <Check /> Approve
              </Button>
              <Button size="sm" variant="ghost" loading={dismiss.isPending && dismiss.variables?.id === r.id} onClick={() => dismiss.mutate(r)}>
                <X /> Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Clinics on a free trial or free period, ending soonest first: what happens next, and "Mark as paid" to end the
 * trial now (the clinic keeps its plan and starts paying).
 */
export function TrialsList({ clinics, onRecordPayment }: { clinics: PlatformClinic[]; onRecordPayment: (c: PlatformClinic) => void }) {
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api.get<PlatformPlan[]>('/platform/plans') });
  const rows = clinics.filter((c) => c.status === 'ACTIVE' && c.payment.kind === 'TRIAL').sort((a, b) => a.trialEndsAt!.localeCompare(b.trialEndsAt!));
  if (!rows.length) return null;
  const planName = (id: string | null) => (id ? plans.data?.find((p) => p.id === id)?.name : null);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-primary/[0.06] px-4 py-3">
        <Gift className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Free trials</h2>
        <span className="rounded-pill bg-primary/15 px-2 py-0.5 text-2xs font-semibold text-primary">{rows.length}</span>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">Record a payment once a clinic pays; otherwise the trial ends by itself.</p>
      </div>
      <ul className="divide-y">
        {rows.map((c) => {
          const left = daysLeft(c.trialEndsAt!);
          const then = planName(c.trialThenPlanId);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-medium">
                  <Link href={`/platform/clinics/${c.id}`} className="text-primary hover:underline">{c.name}</Link>
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{c.planName} plan{c.bill ? ` · then ${planPrice({ priceMonthlyMinor: c.bill.chargeMinor, currency: c.bill.currency })} / ${c.bill.periodMonths === 12 ? 'year' : 'month'}` : ''}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Ends {fmtDate(c.trialEndsAt!)} · then {then ? `moves to ${then}` : 'paused until paid'}
                </p>
              </div>
              <span className={cn('rounded-pill px-2.5 py-1 text-xs font-semibold', left <= 3 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}>
                {left === 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`}
              </span>
              <Button size="sm" variant="outline" onClick={() => onRecordPayment(c)}>
                <BadgeCheck /> Record payment
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
