'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { allergyMatches } from '@vcms/shared';
import { CheckCircle2, Copy, PackageCheck, Printer, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ClinicHeader } from '@/components/billing/invoice-document';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { DescriptionList, ErrorState, LoadingRows } from '@/components/page';
import { DispenseDialog } from '@/components/pharmacy/dispense-dialog';
import { PrescriptionLabels } from '@/components/pharmacy/prescription-label';
import { productStrength } from '@/components/pharmacy/product-picker';
import { AllergyConflictChip, RxStatusBadge } from '@/components/pharmacy/rx-status';
import { RequirePermission } from '@/components/require';
import { AlertChip } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { frequencyLabel, routeLabel, qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Prescription } from '@/lib/types';

function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, session } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['prescription', id], queryFn: () => api.get<Prescription>(`/prescriptions/${id}`) });
  const verify = useQuery({ queryKey: ['rx-verify', id, q.data?.status], queryFn: () => api.get<{ authorized: boolean; valid: boolean | null }>(`/prescriptions/${id}/verify`), enabled: !!q.data && q.data.status !== 'DRAFT' });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api.get<ClinicHeader>('/organization'), staleTime: 300_000, enabled: can('dashboard.view') });
  const [dispense, setDispense] = useState(false);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<Prescription>(`/prescriptions/${id}/${path}`, body),
    onSuccess: (rx, v) => {
      qc.invalidateQueries({ queryKey: ['prescription', id] });
      qc.invalidateQueries({ queryKey: ['prescriptions'] });
      if (v.path === 'repeat') router.push(`/pharmacy/prescriptions/${rx.id}`);
      else toast.success(`${rx.prescriptionNo} updated`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rx = q.data!;
  const dispensable = ['AUTHORIZED', 'PARTIALLY_DISPENSED'].includes(rx.status);

  return (
    <>
      <div className="no-print">
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/pharmacy" className="hover:text-foreground hover:underline">Pharmacy</Link>
          <span>/</span>
          <span>{rx.prescriptionNo}</span>
        </nav>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{rx.prescriptionNo}</h1>
          <RxStatusBadge status={rx.status} />
          {verify.data?.valid === true && <span className="flex items-center gap-1 text-xs text-success" title="The prescription has not changed since it was approved"><ShieldCheck className="h-3.5 w-3.5" /> Approved by {rx.authorizedByName ?? 'the vet'}</span>}
          {verify.data?.valid === false && <span className="flex items-center gap-1 text-xs font-medium text-destructive"><ShieldAlert className="h-3.5 w-3.5" /> Content does not match authorisation</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            {rx.status === 'DRAFT' && can('prescriptions.authorize') && (
              <Button size="sm" loading={act.isPending && act.variables?.path === 'authorize'} onClick={async () => { const r = await confirm({ title: `Authorise ${rx.prescriptionNo}?`, description: 'Authorised prescriptions cannot be edited. Corrections require cancelling and re-prescribing.', confirmLabel: 'Authorise' }); if (r.confirmed) act.mutate({ path: 'authorize' }); }}>
                <CheckCircle2 /> Authorise
              </Button>
            )}
            {dispensable && can('pharmacy.dispense') && <Button size="sm" onClick={() => setDispense(true)}><PackageCheck /> Dispense</Button>}
            {rx.status !== 'DRAFT' && rx.status !== 'CANCELLED' && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> {rx.items.length === 1 ? 'Print label' : 'Print labels'}</Button>}
            {can('prescriptions.write') && rx.status !== 'DRAFT' && <Button size="sm" variant="outline" loading={act.isPending && act.variables?.path === 'repeat'} onClick={() => act.mutate({ path: 'repeat' })}><Copy /> Repeat</Button>}
            {['DRAFT', 'AUTHORIZED', 'PARTIALLY_DISPENSED'].includes(rx.status) && (can('prescriptions.write') || can('prescriptions.authorize')) && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { const r = await confirm({ title: `Cancel ${rx.prescriptionNo}?`, requireReason: true, destructive: true, confirmLabel: 'Cancel prescription' }); if (r.confirmed) act.mutate({ path: 'cancel', body: { reason: r.reason } }); }}>
                <XCircle /> Cancel
              </Button>
            )}
          </div>
        </div>
        {rx.cancelReason && <p className="mb-4 rounded-md border bg-muted px-4 py-2 text-sm">Cancelled: {rx.cancelReason}</p>}
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-4">
            {rx.items.map((i) => (
              <Card key={i.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {i.product.name}
                    <span className="text-xs font-normal text-muted-foreground">{productStrength(i.product)}</span>
                    {i.product.isControlled && <Badge variant="warning">Controlled</Badge>}
                    {rx.status !== 'CANCELLED' && allergyMatches(rx.patient.alerts, i.product).length > 0 && <AllergyConflictChip />}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">{i.quantityDispensed} of {qtyUnit(i.quantity * (1 + i.repeats), i.product.dispensingUnit)} handed over</span>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <p className="text-sm font-medium">{i.instructions}</p>
                  <DescriptionList
                    items={[
                      { label: 'Dose', value: `${i.doseValue} ${i.doseUnit}${i.weightKgUsed ? ` × ${i.weightKgUsed} kg` : ''}` },
                      { label: 'Per administration', value: `${i.amountPerDose} ${i.product.dispensingUnit} · ${routeLabel(i.route)}` },
                      { label: 'How often', value: `${frequencyLabel(i.frequencyText)}${i.durationDays ? ` for ${i.durationDays} days` : ''}` },
                      { label: 'Quantity', value: `${qtyUnit(i.quantity, i.product.dispensingUnit)}${i.repeats ? ` + ${i.repeats} ${i.repeats === 1 ? 'repeat' : 'repeats'}` : ''}` },
                      { label: 'Dose reference', value: i.doseReference ? `${i.doseReference.doseMin}–${i.doseReference.doseMax} ${i.doseReference.doseUnit} (${i.doseReference.source})` : 'None approved for this species' },
                    ]}
                  />
                  {!!i.warnings?.length && (
                    <div className="grid gap-1 rounded-md bg-muted/60 p-2.5 text-xs">
                      {i.warnings.map((w) => <p key={w.message} className={w.blocking ? 'font-medium text-destructive' : 'text-muted-foreground'}>{w.blocking ? '⚠ ' : 'ℹ '}{w.message}</p>)}
                      {i.overrideReason && <p className="font-medium">Override reason: {i.overrideReason}</p>}
                    </div>
                  )}
                  {!!i.dispensations.length && (
                    <ul className="divide-y rounded-md border text-xs">
                      {i.dispensations.map((d) => (
                        <li key={d.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                          <span>{d.quantity} {i.product.dispensingUnit}{d.batchNumber && ` · batch ${d.batchNumber}`}{d.expiryDate && ` · exp ${fmtDate(d.expiryDate)}`}</span>
                          <span className="text-muted-foreground">{d.dispensedByName} · {fmtDateTime(d.dispensedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader><CardTitle>Patient</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <Link href={`/patients/${rx.patient.id}`} className="font-medium hover:underline">{rx.patient.name}</Link>
                <p className="text-xs text-muted-foreground">{rx.patient.species.name} · {rx.weightKg ? `${fmtWeight(rx.weightKg)} at prescribing` : 'weight not recorded'}</p>
                <Link href={`/clients/${rx.client.id}`} className="text-sm hover:underline">{rx.client.displayName}</Link>
                <div className="flex flex-wrap gap-1">{rx.patient.alerts.map((a) => <AlertChip key={a.id} alert={a} />)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Details</CardTitle></CardHeader>
              <CardContent>
                <DescriptionList
                  className="sm:grid-cols-1"
                  items={[
                    { label: 'Prescriber', value: rx.prescriber ? `${rx.prescriber.name}${rx.prescriber.registration ? ` (${rx.prescriber.registration})` : ''}` : rx.createdByName },
                    { label: 'Authorised', value: rx.authorizedAt && `${rx.authorizedByName} · ${fmtDateTime(rx.authorizedAt)}` },
                    { label: 'Created', value: `${rx.createdByName} · ${fmtDateTime(rx.createdAt)}` },
                    { label: 'Valid until', value: rx.validUntil && fmtDate(rx.validUntil) },
                    {
                      label: 'Consultation',
                      value:
                        rx.encounterId &&
                        (can('clinical.read') ? (
                          <Link className="text-primary hover:underline" href={`/consultations/${rx.encounterId}`}>{rx.encounterNo ? `${rx.encounterNo} · ` : ''}View consultation</Link>
                        ) : (
                          rx.encounterNo ?? 'Linked consultation'
                        )),
                    },
                    { label: 'Notes', value: rx.notes },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        <DispenseDialog rx={rx} open={dispense} onOpenChange={setDispense} />
      </div>
      <PrescriptionLabels rx={rx} clinic={org.data ?? { name: session.organization?.name ?? '' }} />
    </>
  );
}

export default function PrescriptionPage() {
  return (
    <RequirePermission anyOf={['prescriptions.read', 'pharmacy.dispense']}>
      <Detail />
    </RequirePermission>
  );
}
