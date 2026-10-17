'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPOINTMENT_CATEGORIES, enumLabel } from '@vcms/shared';
import { CalendarRange, Edit, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { usePortalEnabled, useSession } from '@/lib/session';
import type { AppointmentType, Service } from '@/lib/types';

function TypeDialog({ type, open, onOpenChange }: { type: AppointmentType | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: type?.name ?? '',
    category: type?.category ?? 'CONSULTATION',
    durationMinutes: type?.durationMinutes ?? 15,
    color: type?.color ?? '#0d7a70',
    serviceId: type?.serviceId ?? '',
    requiresClinician: type?.requiresClinician ?? true,
    allowOnlineBooking: type?.allowOnlineBooking ?? false,
    isActive: type?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const portal = usePortalEnabled();
  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api.get<Service[]>('/services') });
  const linked = (services.data ?? []).find((x) => x.id === f.serviceId) ?? null;
  const save = useMutation({
    mutationFn: () => {
      // The price comes from the linked service (one price to maintain); the old indicative price is left as it is.
      const { serviceId, ...rest } = f;
      const body = { ...rest, serviceId: serviceId || null };
      return type ? api.patch(`/appointment-types/${type.id}`, body) : api.post('/appointment-types', body);
    },
    onSuccess: () => {
      toast.success('Appointment type saved');
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
      qc.invalidateQueries({ queryKey: ['services'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? `Edit ${type.name}` : 'Add appointment type'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {error && <FormError message={error} />}
          <Field label="Name" htmlFor="at-n" required><Input id="at-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="at-c">
              <NativeSelect id="at-c" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {APPOINTMENT_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Duration (minutes)" htmlFor="at-d" required><Input id="at-d" type="number" min={5} max={600} step={5} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} /></Field>
            <Field label="Charge for this appointment" htmlFor="at-svc" hint="Added to the bill automatically when the visit is finished." className="col-span-2">
              <NativeSelect id="at-svc" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
                <option value="">Not billed automatically</option>
                {(services.data ?? []).filter((x) => x.isActive || x.id === f.serviceId).map((x) => <option key={x.id} value={x.id}>{x.name} ({fmtMoney(x.priceMinor, currency)})</option>)}
              </NativeSelect>
            </Field>
            {linked && (
              <p className="col-span-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                Charge for this appointment: <b>{linked.name}</b> — <span className="tabular">{fmtMoney(linked.priceMinor, currency)}</span> ·{' '}
                <Link className="font-medium text-primary hover:underline" href="/settings/services">Edit price</Link>
              </p>
            )}
            <Field label="Colour" htmlFor="at-col"><Input id="at-col" type="color" className="h-9 p-1" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
          </div>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.requiresClinician} onCheckedChange={(v) => setF({ ...f, requiresClinician: v === true })} /> Requires a clinician</label>
            {portal && <label className="flex items-center gap-2"><Checkbox checked={f.allowOnlineBooking} onCheckedChange={(v) => setF({ ...f, allowOnlineBooking: v === true })} /> Available for online booking (client portal)</label>}
            {type && <label className="flex items-center gap-2"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v === true })} /> Active</label>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim()} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AppointmentTypesPage() {
  const { currency } = useSession();
  const portal = usePortalEnabled();
  const q = useAppointmentTypes(true);
  const [dlg, setDlg] = useState<{ open: boolean; type: AppointmentType | null; key: number }>({ open: false, type: null, key: 0 });
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <CardTitle>Appointment types</CardTitle>
          <Button size="sm" onClick={() => setDlg({ open: true, type: null, key: Date.now() })}><Plus /> Add appointment type</Button>
        </CardHeader>
        <DataTable
          query={q}
          rowKey={(t) => t.id}
          empty={<EmptyState icon={CalendarRange} title="No appointment types" description="Create at least one type before booking appointments." />}
          columns={[
            { key: 'name', header: 'Name', cell: (t) => <span className="flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />{t.name}</span> },
            { key: 'cat', header: 'Category', cell: (t) => enumLabel(t.category) },
            { key: 'dur', header: 'Duration', cell: (t) => `${t.durationMinutes} min` },
            { key: 'price', header: 'Charge', cell: (t) => (t.service ? <span className="text-sm">{t.service.name} · <span className="tabular">{fmtMoney(t.service.priceMinor, currency)}</span></span> : <span className="text-xs text-muted-foreground">Not billed automatically</span>) },
            { key: 'opts', header: 'Options', cell: (t) => <span className="text-xs text-muted-foreground">{[t.requiresClinician && 'Clinician', portal && t.allowOnlineBooking && 'Online'].filter(Boolean).join(' · ')}</span> },
            { key: 'st', header: 'Status', cell: (t) => <StatusBadge status={t.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
            { key: 'act', header: '', className: 'text-right', cell: (t) => <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setDlg({ open: true, type: t, key: Date.now() })}><Edit /></Button> },
          ]}
        />
      </Card>
      {dlg.open && <TypeDialog key={dlg.key} type={dlg.type} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />}
    </RequirePermission>
  );
}
