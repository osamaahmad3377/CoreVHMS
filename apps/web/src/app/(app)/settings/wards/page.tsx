'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WARD_TYPES, enumLabel } from '@vcms/shared';
import { BedDouble, Edit, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Service, WardRow } from '@/lib/types';

function WardDialog({ ward, open, onOpenChange }: { ward: WardRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session, currency } = useSession();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services'), enabled: open });
  const [f, setF] = useState({ branchId: '', name: '', type: 'GENERAL', dailyServiceId: '', sortOrder: 0, isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setError(null); setF(ward ? { branchId: ward.branchId, name: ward.name, type: ward.type, dailyServiceId: ward.dailyServiceId ?? '', sortOrder: ward.sortOrder, isActive: ward.isActive } : { branchId: session.branch?.id ?? '', name: '', type: 'GENERAL', dailyServiceId: '', sortOrder: 0, isActive: true }); }
  }, [open, ward, session.branch?.id]);
  const m = useMutation({
    mutationFn: () => { const body = { ...f, dailyServiceId: f.dailyServiceId || null }; return ward ? api.patch(`/wards/${ward.id}`, body) : api.post('/wards', body); },
    onSuccess: () => { toast.success('Ward saved'); qc.invalidateQueries({ queryKey: ['wards'] }); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ward ? `Edit ${ward.name}` : 'New ward'}</DialogTitle>
          <DialogDescription>The daily fee is charged once per started 24 hours that a patient spends in this ward.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Branch" htmlFor="wd-branch"><NativeSelect id="wd-branch" value={f.branchId} disabled={!!ward} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>
          <Field label="Type" htmlFor="wd-type"><NativeSelect id="wd-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{WARD_TYPES.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}</NativeSelect></Field>
          <Field label="Name" htmlFor="wd-name" required className="sm:col-span-2"><Input id="wd-name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Daily fee (service)" htmlFor="wd-svc" className="sm:col-span-2" hint="Create a “per day” service in Services & fees first.">
            <NativeSelect id="wd-svc" value={f.dailyServiceId} onChange={(e) => setF({ ...f, dailyServiceId: e.target.value })}>
              <option value="">No daily fee</option>
              {(services.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name} ({fmtMoney(s.priceMinor, currency)})</option>)}
            </NativeSelect>
          </Field>
          <Field label="Display order" htmlFor="wd-order"><Input id="wd-order" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) || 0 })} /></Field>
          {ward && <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.name.trim()} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CageRow({ wardId }: { wardId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/cages', { wardId, name }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['wards'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="flex gap-2">
      <Input aria-label="New cage name" className="h-8 w-40" placeholder="e.g. K7" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && m.mutate()} />
      <Button size="sm" variant="outline" disabled={!name.trim()} loading={m.isPending} onClick={() => m.mutate()}><Plus /> Add cage</Button>
    </div>
  );
}

export default function WardsSettingsPage() {
  const qc = useQueryClient();
  const { currency } = useSession();
  const q = useQuery({ queryKey: ['wards', 'all'], queryFn: () => api.get<WardRow[]>('/wards?all=true') });
  const [dlg, setDlg] = useState<{ open: boolean; ward: WardRow | null }>({ open: false, ward: null });
  const toggleCage = useMutation({
    mutationFn: (c: { id: string; wardId: string; name: string; isActive: boolean }) => api.patch(`/cages/${c.id}`, { wardId: c.wardId, name: c.name, isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wards'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Wards & cages</h2>
            <p className="text-sm text-muted-foreground">Where inpatients stay. Cages can be kennels, runs or stalls.</p>
          </div>
          <Button size="sm" onClick={() => setDlg({ open: true, ward: null })}><Plus /> New ward</Button>
        </div>
        {!q.data?.length && !q.isLoading && <Card><EmptyState icon={BedDouble} title="No wards yet" description="Add a ward, then add its cages or kennels." /></Card>}
        {(q.data ?? []).map((w) => (
          <Card key={w.id}>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">{w.name} {!w.isActive && <StatusBadge status="ARCHIVED" />}</CardTitle>
                <p className="text-xs text-muted-foreground">{enumLabel(w.type)} · {w.branch?.name} · {w.dailyService ? `${w.dailyService.name} ${fmtMoney(w.dailyService.priceMinor, currency)}/day` : 'no daily fee'}</p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label={`Edit ${w.name}`} onClick={() => setDlg({ open: true, ward: w })}><Edit /></Button>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {w.cages.map((c) => (
                  <button key={c.id} type="button" title={c.occupant ? `Occupied by ${c.occupant.patient.name}` : c.isActive ? 'Click to deactivate' : 'Click to reactivate'} disabled={!!c.occupant} onClick={() => toggleCage.mutate({ ...c, wardId: w.id })} className={`rounded-md border px-3 py-1.5 text-sm ${c.isActive ? '' : 'text-muted-foreground line-through'} ${c.occupant ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted'}`}>
                    {c.name}{c.occupant ? ` · ${c.occupant.patient.name}` : ''}
                  </button>
                ))}
                {!w.cages.length && <span className="text-sm text-muted-foreground">No cages yet.</span>}
              </div>
              <CageRow wardId={w.id} />
            </CardContent>
          </Card>
        ))}
      </div>
      <WardDialog ward={dlg.ward} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </RequirePermission>
  );
}
