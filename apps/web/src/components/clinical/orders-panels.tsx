'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { AlertOctagon, FlaskConical, Pill, Plus, Syringe, Tractor } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { LabOrderDialog } from '../lab/order-dialog';
import { LabStatusBadge } from '../lab/lab-status';
import { AdministerDialog } from '../pharmacy/administer-dialog';
import { PrescriptionDialog } from '../pharmacy/prescription-dialog';
import { RxStatusBadge } from '../pharmacy/rx-status';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { frequencyLabel, qtyUnit, routeLabel } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { ActiveWithdrawal, Administration, AlertSummary, DiagnosticOrder, Prescription } from '@/lib/types';

interface Ctx {
  patient: { id: string; name: string; latestWeightKg: number | null; alerts?: AlertSummary[] };
  encounterId?: string | null;
  editable: boolean;
  /** Optional control of the panel's dialog, so a page-level action bar can open it. */
  dialogOpen?: boolean;
  onDialogOpenChange?: (open: boolean) => void;
}

/** The panel's own dialog state, unless the page controls it. */
function useDialog(ctx: Ctx): [boolean, (o: boolean) => void] {
  const [own, setOwn] = useState(false);
  return [ctx.dialogOpen ?? own, ctx.onDialogOpenChange ?? setOwn];
}

/** One slim line instead of a large empty-state block, so empty cards take little room. */
export function SlimEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>;
}

export function PrescriptionsPanel(props: Ctx) {
  const { patient, encounterId, editable } = props;
  const { can } = useSession();
  const [open, setOpen] = useDialog(props);
  const q = useQuery({ queryKey: ['prescriptions', { patientId: patient.id, encounterId }], queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId: patient.id, encounterId: encounterId ?? undefined, pageSize: 50 })}`) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Pill className="h-4 w-4 text-muted-foreground" /> Prescriptions</CardTitle>
        {editable && can('prescriptions.write') && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus /> Prescribe</Button>}
      </CardHeader>
      {q.data?.data.length ? (
        <ul className="divide-y">
          {q.data.data.map((rx) => (
            <li key={rx.id}>
              <Link href={`/pharmacy/prescriptions/${rx.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{rx.items.map((i) => `${i.product.name} — ${qtyUnit(i.amountPerDose, i.product.dispensingUnit)}, ${frequencyLabel(i.frequencyText).replace(/^./, (c) => c.toLowerCase())}`).join('; ')}</span>
                  <span className="block text-2xs text-muted-foreground">{rx.prescriptionNo} · {fmtDateTime(rx.createdAt)}</span>
                </span>
                <RxStatusBadge status={rx.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <SlimEmpty>No prescriptions yet.</SlimEmpty>}
      <PrescriptionDialog open={open} onOpenChange={setOpen} patient={patient} encounterId={encounterId} />
    </Card>
  );
}

export function AdministrationsPanel(props: Ctx) {
  const { patient, encounterId, editable } = props;
  const { canAny } = useSession();
  const [open, setOpen] = useDialog(props);
  const q = useQuery({ queryKey: ['administrations', patient.id, encounterId], queryFn: () => api.get<Administration[]>(`/patients/${patient.id}/administrations${qs({ encounterId: encounterId ?? undefined })}`) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Syringe className="h-4 w-4 text-muted-foreground" /> Medicines given in clinic</CardTitle>
        {editable && canAny('clinical.write', 'hospital.write', 'pharmacy.dispense') && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus /> Give medicine now (in clinic)</Button>}
      </CardHeader>
      {q.data?.length ? (
        <ul className="divide-y">
          {q.data.map((a) => (
            <li key={a.id} className="px-3 py-2">
              <p className={`text-sm ${a.status === 'NOT_GIVEN' ? 'text-muted-foreground line-through' : ''}`}>{a.product.name} {a.dose} {a.doseUnit} · {routeLabel(a.route)}{a.site && ` · ${a.site}`}</p>
              <p className="text-2xs text-muted-foreground">{fmtDateTime(a.administeredAt)} · {a.administeredByName}{a.batchNumber && ` · batch ${a.batchNumber}`}{a.reasonNotGiven && ` · not given: ${a.reasonNotGiven}`}</p>
            </li>
          ))}
        </ul>
      ) : <SlimEmpty>No medicines given in clinic yet.</SlimEmpty>}
      <AdministerDialog open={open} onOpenChange={setOpen} patientId={patient.id} encounterId={encounterId} />
    </Card>
  );
}

export function LabOrdersPanel(props: Ctx) {
  const { patient, encounterId, editable } = props;
  const { can } = useSession();
  const [open, setOpen] = useDialog(props);
  const q = useQuery({ queryKey: ['lab-orders', { patientId: patient.id, encounterId }], queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId: patient.id, encounterId: encounterId ?? undefined, pageSize: 50 })}`), enabled: can('lab.read') });
  if (!can('lab.read')) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-muted-foreground" /> Tests (lab & X-ray)</CardTitle>
        {editable && can('lab.order') && <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Plus /> Order test</Button>}
      </CardHeader>
      {q.data?.data.length ? (
        <ul className="divide-y">
          {q.data.data.map((o) => (
            <li key={o.id}>
              <Link href={`/lab/orders/${o.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-sm">{o.hasCritical && <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-destructive" />}{o.items.map((i) => i.test.name).join(', ')}</span>
                  <span className="block text-2xs text-muted-foreground">{o.orderNo} · {fmtDateTime(o.createdAt)}{o.priority !== 'ROUTINE' && ` · ${enumLabel(o.priority)}`}</span>
                </span>
                <LabStatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : <SlimEmpty>No tests ordered yet.</SlimEmpty>}
      <LabOrderDialog open={open} onOpenChange={setOpen} patient={patient} encounterId={encounterId} />
    </Card>
  );
}

/** Food-safety withdrawal warning shown on livestock records while meat/milk/eggs are not yet clear. */
export function WithdrawalBanner({ patientId }: { patientId: string }) {
  const q = useQuery({ queryKey: ['withdrawals', patientId], queryFn: () => api.get<ActiveWithdrawal[]>(`/patients/${patientId}/withdrawals`) });
  if (!q.data?.length) return null;
  return (
    <div role="alert" className="mb-3 flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <Tractor className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="grid gap-0.5">
        <p className="font-semibold text-destructive">Withdrawal period active — do not supply for human consumption</p>
        {q.data.map((w) => (
          <p key={w.id}>
            {w.product.name}: {w.meatActive && <>meat until <b>{fmtDateTime(w.meatClearAt)}</b> </>}
            {w.milkActive && <>· milk until <b>{fmtDateTime(w.milkClearAt)}</b> </>}
            {w.eggActive && <>· eggs until <b>{fmtDateTime(w.eggClearAt)}</b></>}
            <span className="text-xs text-muted-foreground"> ({w.source})</span>
          </p>
        ))}
      </div>
    </div>
  );
}
