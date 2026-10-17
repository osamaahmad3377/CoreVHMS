'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARDING_UNIT_TYPES, enumLabel } from '@vcms/shared';
import { Edit, Home, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { BoardingUnit, Service } from '@/lib/types';

function UnitDialog({ unit, open, onOpenChange }: { unit: BoardingUnit | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session, currency } = useSession();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const [f, setF] = useState({ branchId: '', name: '', type: 'KENNEL', nightlyServiceId: '', notes: '', sortOrder: 0, isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setError(null); setF(unit ? { branchId: unit.branchId, name: unit.name, type: unit.type, nightlyServiceId: unit.nightlyServiceId ?? '', notes: unit.notes ?? '', sortOrder: unit.sortOrder, isActive: unit.isActive } : { branchId: session.branch?.id ?? '', name: '', type: 'KENNEL', nightlyServiceId: '', notes: '', sortOrder: 0, isActive: true }); }
  }, [open, unit, session.branch?.id]);
  const m = useMutation({
    mutationFn: () => { const body = { ...f, nightlyServiceId: f.nightlyServiceId || null }; return unit ? api.patch(`/boarding/units/${unit.id}`, body) : api.post('/boarding/units', body); },
    onSuccess: () => { toast.success('Unit saved'); qc.invalidateQueries({ queryKey: ['boarding-units'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{unit ? `Edit ${unit.name}` : 'New boarding unit'}</DialogTitle><DialogDescription>The nightly rate is fixed on each booking when it is made.</DialogDescription></DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Branch" htmlFor="bu-branch"><NativeSelect id="bu-branch" value={f.branchId} disabled={!!unit} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
          <Field label="Type" htmlFor="bu-type"><NativeSelect id="bu-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{BOARDING_UNIT_TYPES.map((t) => <option key={t} value={t}>{t === 'KENNEL' ? 'Kennel' : enumLabel(t)}</option>)}</NativeSelect></Field>
          <Field label="Name" htmlFor="bu-name" required><Input id="bu-name" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Kennel 4, Cat suite A" /></Field>
          <Field label="Order" htmlFor="bu-order"><Input id="bu-order" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) || 0 })} /></Field>
          <Field label="Nightly rate (service)" htmlFor="bu-svc" className="sm:col-span-2" hint="Create a “per night” boarding service in Services & fees first.">
            <NativeSelect id="bu-svc" value={f.nightlyServiceId} onChange={(e) => setF({ ...f, nightlyServiceId: e.target.value })}>
              <option value="">No charge</option>
              {(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.priceMinor, currency)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Notes" htmlFor="bu-notes" className="sm:col-span-2"><Input id="bu-notes" value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Large dogs only, heated" /></Field>
          {unit && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> In use</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim() || !f.branchId} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BoardingUnitsPage() {
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['boarding-units', 'all'], queryFn: () => api.get<BoardingUnit[]>('/boarding/units?all=true') });
  const [dlg, setDlg] = useState<{ open: boolean; unit: BoardingUnit | null }>({ open: false, unit: null });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader className="flex-wrap">
          <div className="min-w-0">
            <CardTitle>Boarding units</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Kennels, cattery pens and suites for boarders (separate from hospital cages).</p>
          </div>
          <Button size="sm" onClick={() => setDlg({ open: true, unit: null })}><Plus /> New unit</Button>
        </CardHeader>
        {q.data?.length ? (
          <ul className="divide-y">
            {q.data.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name} {!u.isActive && <StatusBadge status="ARCHIVED" />}</p>
                  <p className="text-xs text-muted-foreground">{u.type === 'KENNEL' ? 'Kennel' : enumLabel(u.type)} · {u.nightlyService ? `${fmtMoney(u.nightlyService.priceMinor, currency)} per night` : 'no charge'}{u.notes ? ` · ${u.notes}` : ''}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setDlg({ open: true, unit: u })}><Edit /></Button>
              </li>
            ))}
          </ul>
        ) : q.isLoading ? <LoadingRows /> : <EmptyState icon={Home} title="No boarding units yet" description="Add kennels or pens to start taking boarding bookings." />}
      </Card>
      <UnitDialog unit={dlg.unit} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </RequirePermission>
  );
}
