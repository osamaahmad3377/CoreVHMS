'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_KIND_HINTS, enumLabel } from '@vcms/shared';
import { CalendarRange, Edit, Eye, EyeOff, Plus, Tags, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Input, NativeSelect } from '@/components/ui/input';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { usePortalEnabled, useSession } from '@/lib/session';
import type { AppointmentType, AppointmentTypeCategory, Service } from '@/lib/types';
import { useConfirm } from '@/components/confirm';

function TypeDialog({ type, open, onOpenChange }: { type: AppointmentType | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: type?.name ?? '',
    categoryId: type?.categoryId ?? '',
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
  const categories = useCategories(true);
  const choices = (categories.data ?? []).filter((c) => c.isActive || c.id === f.categoryId);
  const chosen = choices.find((c) => c.id === f.categoryId);
  // A new type starts in the first category (Consultation unless the clinic changed the order).
  // A type not yet linked to a category keeps its kind: preselect a category of that kind (new types: the first one).
  const fallbackId = (type ? choices.find((c) => c.kind === type.category && c.isActive) ?? choices.find((c) => c.kind === type.category) : undefined)?.id ?? choices[0]?.id;
  useEffect(() => {
    if (fallbackId) setF((cur) => (cur.categoryId ? cur : { ...cur, categoryId: fallbackId }));
  }, [fallbackId]);
  const save = useMutation({
    mutationFn: () => {
      // The price comes from the linked service (one price to maintain); the old indicative price is left as it is.
      const { serviceId, categoryId, ...rest } = f;
      const body = { ...rest, serviceId: serviceId || null, categoryId: categoryId || null };
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
            <Field label="Category" htmlFor="at-c" hint={chosen && chosen.name !== enumLabel(chosen.kind) ? `Works like ${enumLabel(chosen.kind).toLowerCase()}` : undefined}>
              <NativeSelect id="at-c" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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

function useCategories(all = false) {
  return useQuery({ queryKey: ['appointment-categories', all], queryFn: () => api.get<AppointmentTypeCategory[]>(`/appointment-categories${all ? '?all=true' : ''}`) });
}

/** The clinic's own categories: each has a name and works like one built-in kind (what the app goes by). */
function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useCategories(true);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('CONSULTATION');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointment-categories'] });
    qc.invalidateQueries({ queryKey: ['appointment-types'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const add = () =>
    act.mutate(() =>
      api.post('/appointment-categories', { name: name.trim(), kind, sortOrder: ((list.data ?? []).reduce((n, c) => Math.max(n, c.sortOrder), 0) || 100) + 10 }).then(() => {
        toast.success(`${name.trim()} added`);
        setName('');
      }),
    );
  const rename = (c: AppointmentTypeCategory) => {
    const v = (edits[c.id] ?? c.name).trim();
    if (!v || v === c.name) return;
    act.mutate(() => api.patch(`/appointment-categories/${c.id}`, { name: v }).then(() => toast.success('Renamed')));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Appointment categories</DialogTitle>
          <DialogDescription>Name them the way your clinic works. Each one works like a built-in kind — that is what decides, for example, whether an appointment can be checked in for grooming or is offered when booking surgery.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className={cn('grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_15.5rem_auto]', !c.isActive && 'opacity-60')}>
              <Input
                aria-label={`Name of ${c.name}`}
                value={edits[c.id] ?? c.name}
                maxLength={60}
                onChange={(e) => setEdits((x) => ({ ...x, [c.id]: e.target.value }))}
                onBlur={() => rename(c)}
                onKeyDown={(e) => e.key === 'Enter' && rename(c)}
              />
              <NativeSelect
                aria-label={`What ${c.name} works like`}
                title={APPOINTMENT_KIND_HINTS[c.kind as keyof typeof APPOINTMENT_KIND_HINTS]}
                value={c.kind}
                onChange={(e) => act.mutate(() => api.patch(`/appointment-categories/${c.id}`, { kind: e.target.value }).then(() => toast.success(`${c.name} now works like ${enumLabel(e.target.value).toLowerCase()}`)))}
              >
                {APPOINTMENT_CATEGORIES.map((k) => <option key={k} value={k}>Works like: {enumLabel(k)}</option>)}
              </NativeSelect>
              <div className="flex items-center justify-end gap-1">
                <span className="w-16 text-right text-xs text-muted-foreground">{c._count?.appointmentTypes ? `${c._count.appointmentTypes} type${c._count.appointmentTypes === 1 ? '' : 's'}` : 'unused'}</span>
                <Button size="icon-sm" variant="ghost" aria-label={c.isActive ? `Hide ${c.name}` : `Show ${c.name}`} title={c.isActive ? 'Hide from the list (types keep it)' : 'Show again'} onClick={() => act.mutate(() => api.patch(`/appointment-categories/${c.id}`, { isActive: !c.isActive }))}>
                  {c.isActive ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${c.name}`}
                  disabled={!!c._count?.appointmentTypes}
                  title={c._count?.appointmentTypes ? 'In use — hide it instead' : 'Delete'}
                  onClick={async () => {
                    const r = await confirm({ title: `Delete ${c.name}?`, confirmLabel: 'Delete', destructive: true });
                    if (r.confirmed) act.mutate(() => api.del(`/appointment-categories/${c.id}`));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="grid items-end gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[minmax(0,1fr)_15.5rem_auto]">
          <Field label="New category" htmlFor="ac-name">
            <Input id="ac-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior care, Puppy visit, Nail trim" onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
          </Field>
          <Field label="Works like" htmlFor="ac-kind">
            <NativeSelect id="ac-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {APPOINTMENT_CATEGORIES.map((k) => <option key={k} value={k}>{enumLabel(k)}</option>)}
            </NativeSelect>
          </Field>
          <Button disabled={!name.trim()} loading={act.isPending} onClick={add}><Plus /> Add</Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">{APPOINTMENT_KIND_HINTS[kind as keyof typeof APPOINTMENT_KIND_HINTS]}.</p>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
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
  const [managing, setManaging] = useState(false);
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <CardTitle>Appointment types</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}><Tags /> Categories</Button>
            <Button size="sm" onClick={() => setDlg({ open: true, type: null, key: Date.now() })}><Plus /> Add appointment type</Button>
          </div>
        </CardHeader>
        <DataTable
          query={q}
          rowKey={(t) => t.id}
          empty={<EmptyState icon={CalendarRange} title="No appointment types" description="Create at least one type before booking appointments." />}
          columns={[
            { key: 'name', header: 'Name', cell: (t) => <span className="flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: t.color }} />{t.name}</span> },
            { key: 'cat', header: 'Category', cell: (t) => t.categoryRef?.name ?? enumLabel(t.category) },
            { key: 'dur', header: 'Duration', cell: (t) => `${t.durationMinutes} min` },
            { key: 'price', header: 'Charge', cell: (t) => (t.service ? <span className="text-sm">{t.service.name} · <span className="tabular">{fmtMoney(t.service.priceMinor, currency)}</span></span> : <span className="text-xs text-muted-foreground">Not billed automatically</span>) },
            { key: 'opts', header: 'Options', cell: (t) => <span className="text-xs text-muted-foreground">{[t.requiresClinician && 'Clinician', portal && t.allowOnlineBooking && 'Online'].filter(Boolean).join(' · ')}</span> },
            { key: 'st', header: 'Status', cell: (t) => <StatusBadge status={t.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
            { key: 'act', header: '', className: 'text-right', cell: (t) => <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setDlg({ open: true, type: t, key: Date.now() })}><Edit /></Button> },
          ]}
        />
      </Card>
      <CategoriesDialog open={managing} onOpenChange={setManaging} />
      {dlg.open && <TypeDialog key={dlg.key} type={dlg.type} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />}
    </RequirePermission>
  );
}
