'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { enumLabel } from '@vcms/shared';
import { Pill } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { ErrorState, LoadingRows } from '../page';
import { DispenseDialog } from '../pharmacy/dispense-dialog';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Charge, Prescription } from '@/lib/types';

/**
 * "Collect a prescription" at the shop counter: choose the client, pick one of their authorised prescriptions,
 * hand the medicines out (batches and stock as in the pharmacy), and the medicines go into this sale to be paid
 * with everything else. Prescription-only medicines are never sold without a prescription.
 */
export function CollectPrescriptionDialog({
  open,
  onOpenChange,
  client,
  onClient,
  onCollected,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: PickedClient | null;
  onClient: (c: PickedClient | null) => void;
  /** The medicines just handed out, as charges waiting to be invoiced. */
  onCollected: (charges: Charge[]) => void;
}) {
  const { can } = useSession();
  const [rx, setRx] = useState<Prescription | null>(null);
  const [before, setBefore] = useState<Set<string>>(new Set());
  const [handing, setHanding] = useState(false);
  const list = useQuery({
    queryKey: ['pos', 'prescriptions', client?.id],
    queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ clientId: client!.id, status: 'AUTHORIZED,PARTIALLY_DISPENSED', pageSize: 30 })}`),
    enabled: open && !!client,
  });
  const open_ = async (id: string) => {
    try {
      const full = await api.get<Prescription>(`/prescriptions/${id}`);
      setBefore(new Set(full.items.flatMap((i) => i.dispensations.map((d) => d.id))));
      setRx(full);
      setHanding(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  /** After handing out: find the charges the pharmacy just created and move them into the sale. */
  const collected = async (r: Prescription) => {
    const fresh = new Set(r.items.flatMap((i) => i.dispensations.map((d) => d.id)).filter((id) => !before.has(id)));
    if (!fresh.size) return;
    try {
      const charges = await api.get<Paginated<Charge>>(`/charges${qs({ clientId: r.client.id, status: 'PENDING', pageSize: 100 })}`);
      const mine = charges.data.filter((c) => c.sourceType === 'Dispensation' && fresh.has(c.sourceId));
      if (mine.length) {
        onCollected(mine);
        toast.success(`${r.prescriptionNo}: ${mine.length === 1 ? 'medicine' : 'medicines'} added to this sale`);
      } else toast.message('Medicines handed out. They are waiting under “Not yet invoiced” in Billing.');
    } catch {
      toast.message('Medicines handed out. They are waiting under “Not yet invoiced” in Billing.');
    }
    onOpenChange(false);
    qcRefresh();
  };
  const qcRefresh = () => list.refetch();
  const rows = list.data?.data ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Collect a prescription</DialogTitle>
            <DialogDescription>For medicines a vet has prescribed. Choose the client, then hand the medicines out. They are added to this sale, ready to pay.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <ClientPicker value={client} onChange={onClient} />
            {!client ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Pick the client to see their prescriptions.</p>
            ) : list.isLoading ? (
              <LoadingRows rows={3} />
            ) : list.error ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{client.displayName} has no prescription waiting to be handed out. A vet authorises it in the consultation or the pharmacy first.</p>
            ) : (
              <ul className="grid gap-2">
                {rows.map((p) => (
                  <li key={p.id} className="rounded-xl surface-flat p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{p.prescriptionNo}</span>
                      <span className="text-xs text-muted-foreground">for {p.patient.name} · {fmtDate(p.createdAt)}{p.prescriber ? ` · ${p.prescriber.name}` : ''}</span>
                      <Badge variant={p.status === 'PARTIALLY_DISPENSED' ? 'warning' : 'success'} className="ml-auto">{enumLabel(p.status)}</Badge>
                    </div>
                    <ul className="mt-2 grid gap-0.5 text-sm">
                      {p.items.filter((i) => i.remaining > 0).map((i) => (
                        <li key={i.id}>
                          <span className="font-medium">{i.product.name}</span>
                          <span className="text-xs text-muted-foreground"> — {qtyUnit(i.remaining, i.product.dispensingUnit)} left to hand out</span>
                        </li>
                      ))}
                    </ul>
                    {can('pharmacy.dispense') ? (
                      <Button size="sm" className="mt-2.5" onClick={() => open_(p.id)}>Hand out these medicines</Button>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Your role cannot hand out medicines. Ask the pharmacy.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {rx && <DispenseDialog rx={rx} open={handing} onOpenChange={setHanding} onDispensed={collected} />}
    </>
  );
}
