'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APPOINTMENT_CATEGORIES, APPOINTMENT_KIND_HINTS, enumLabel, fromMinor } from '@vcms/shared';
import { CalendarRange, Edit, Eye, EyeOff, MessageSquareText, Plus, Tags, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { codeFromName } from '@/components/billing/service-code';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Input, NativeSelect } from '@/components/ui/input';
import { useAppointmentTypes } from '@/hooks/use-catalog';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useModuleOn, usePortalEnabled, useSession } from '@/lib/session';
import { DentalPricesPanel } from '@/components/dental/dental-prices-panel';
import type { AppointmentType, AppointmentTypeCategory, ClinicalTemplateRow, Service } from '@/lib/types';
import { useConfirm } from '@/components/confirm';
import { DeleteRecordButton } from '@/components/delete-record';

/** Colours that read well on the calendar; any other colour can still be picked. */
const SWATCHES = ['#0d7a70', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#0891b2', '#475569'];
const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120];
/** The price-list group a new price for this kind of appointment goes in. */
const SERVICE_GROUP: Record<string, string> = { CONSULTATION: 'CONSULTATION', FOLLOW_UP: 'CONSULTATION', EMERGENCY: 'CONSULTATION', VACCINATION: 'VACCINATION', SURGERY: 'SURGERY', DENTAL: 'DENTAL', DIAGNOSTICS: 'DIAGNOSTIC', GROOMING: 'GROOMING', FIELD_VISIT: 'FIELD_VISIT' };
const NEW_PRICE = '__new__';
const NEW_QUESTIONS = '__new__';
const questionsLabel = (n: number) => (n ? `${n} question${n === 1 ? '' : 's'}` : 'no questions yet');

function TypeDialog({ type, open, onOpenChange }: { type: AppointmentType | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currency } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: type?.name ?? '',
    categoryId: type?.categoryId ?? '',
    durationMinutes: type?.durationMinutes ?? 15,
    color: type?.color ?? SWATCHES[0],
    serviceId: type?.serviceId ?? '',
    templateId: type?.templateId ?? '',
    requiresClinician: type?.requiresClinician ?? true,
    allowOnlineBooking: type?.allowOnlineBooking ?? false,
    isActive: type?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const portal = usePortalEnabled();
  const router = useRouter();
  const services = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get<Service[]>('/services?all=true') });
  const templates = useQuery({ queryKey: ['clinical-templates', 'all'], queryFn: () => api.get<ClinicalTemplateRow[]>('/clinical-templates?all=true') });
  const newQuestions = f.templateId === NEW_QUESTIONS;
  const linked = (services.data ?? []).find((x) => x.id === f.serviceId) ?? null;
  // The charge's price can be changed right here (it is the same price as in Services & prices).
  const [price, setPrice] = useState('');
  useEffect(() => setPrice(linked ? fromMinor(linked.priceMinor, currency) : ''), [linked?.id, linked?.priceMinor, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsedPrice = parseMoney(price, currency);
  const categories = useCategories(true);
  const choices = (categories.data ?? []).filter((c) => c.isActive || c.id === f.categoryId);
  const chosen = choices.find((c) => c.id === f.categoryId);
  // A new type starts in the first category (Consultation unless the clinic changed the order).
  // A type not yet linked to a category keeps its kind: preselect a category of that kind (new types: the first one).
  const fallbackId = (type ? choices.find((c) => c.kind === type.category && c.isActive) ?? choices.find((c) => c.kind === type.category) : undefined)?.id ?? choices[0]?.id;
  useEffect(() => {
    if (fallbackId) setF((cur) => (cur.categoryId ? cur : { ...cur, categoryId: fallbackId }));
  }, [fallbackId]);
  const creatingPrice = f.serviceId === NEW_PRICE;
  const save = useMutation({
    mutationFn: async () => {
      let serviceId = f.serviceId || null;
      if (creatingPrice) {
        // A new price for this type: added to Services & prices under the type's name.
        const created = await api.post<Service>('/services', {
          code: codeFromName(f.name, (services.data ?? []).map((x) => x.code)),
          name: f.name.trim(),
          category: SERVICE_GROUP[chosen?.kind ?? ''] ?? 'OTHER',
          priceMinor: parsedPrice ?? 0,
          isActive: true,
        });
        serviceId = created.id;
      } else if (linked && parsedPrice !== null && parsedPrice !== linked.priceMinor) {
        await api.patch(`/services/${linked.id}`, { code: linked.code, name: linked.name, category: linked.category, priceMinor: parsedPrice, taxRateId: linked.taxRateId, isActive: linked.isActive });
      }
      const { categoryId, templateId, ...rest } = f;
      const body = { ...rest, serviceId, categoryId: categoryId || null, templateId: templateId && templateId !== NEW_QUESTIONS ? templateId : null };
      const saved = await (type ? api.patch<AppointmentType>(`/appointment-types/${type.id}`, body) : api.post<AppointmentType>('/appointment-types', body));
      if (!newQuestions) return null;
      // New questions for this type: an empty set under its name, opened straight away to add the questions.
      const tpl = await api.post<ClinicalTemplateRow>('/clinical-templates', { name: f.name.trim(), examSystems: [], questions: [] });
      await api.patch(`/appointment-types/${saved.id}`, { templateId: tpl.id });
      return tpl.id;
    },
    onSuccess: (newTemplateId) => {
      toast.success(newTemplateId ? `${f.name.trim()} saved — now add its questions` : `${f.name.trim()} saved`);
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['clinical-templates'] });
      onOpenChange(false);
      if (newTemplateId) router.push(`/settings/templates?id=${newTemplateId}`);
    },
    onError: (e: Error) => setError(e.message),
  });
  const priceInvalid = (creatingPrice || !!linked) && price.trim() !== '' && parsedPrice === null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{type ? `Edit ${type.name}` : 'Add an appointment type'}</DialogTitle>
          <DialogDescription>Something clients can be booked for: how long it takes, what is charged, and the questions the vet asks.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="at-n" required><Input id="at-n" value={f.name} autoFocus={!type} placeholder="e.g. Puppy check" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Category" htmlFor="at-c" hint={chosen && chosen.name !== enumLabel(chosen.kind) ? `Works like ${enumLabel(chosen.kind).toLowerCase()}` : undefined}>
              <NativeSelect id="at-c" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          </div>

          <Field label="How long it takes" htmlFor="at-d" required>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATIONS.map((d) => (
                <button key={d} type="button" aria-pressed={f.durationMinutes === d} onClick={() => setF({ ...f, durationMinutes: d })} className={cn('h-9 min-w-[3.5rem] rounded-pill border px-3 text-sm font-medium tabular transition-colors', f.durationMinutes === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
                  {d < 60 ? `${d} min` : `${d / 60} h`}
                </button>
              ))}
              <span className="ml-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                or <Input id="at-d" type="number" min={5} max={600} step={5} className="h-9 w-20" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} /> min
              </span>
            </div>
          </Field>

          <Field label="What is charged" htmlFor="at-svc" hint="Added to the bill when the visit is finished. The price is the same one as in Services & prices.">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <NativeSelect id="at-svc" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}>
                <option value="">Nothing — no automatic charge</option>
                <option value={NEW_PRICE}>+ A new price for “{f.name.trim() || 'this type'}”</option>
                {(services.data ?? []).filter((x) => x.isActive || x.id === f.serviceId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </NativeSelect>
              {(creatingPrice || linked) && (
                <MoneyInput aria-label="Price" currency={currency} value={price} onChange={(e) => setPrice(e.target.value)} className={cn(priceInvalid && 'border-destructive')} />
              )}
            </div>
          </Field>

          <Field label="Consultation questions" htmlFor="at-tpl" hint="Asked in the first step of the consultation, with the examination buttons, usual diagnoses and advice that go with them.">
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect id="at-tpl" className="min-w-0 flex-1" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
                <option value="">None — no questions</option>
                <option value={NEW_QUESTIONS}>+ New questions for “{f.name.trim() || 'this type'}”</option>
                {(templates.data ?? []).filter((t) => t.isActive || t.id === f.templateId).map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {questionsLabel(t.questions?.length ?? 0)}</option>
                ))}
              </NativeSelect>
              {f.templateId && !newQuestions && (
                <Link href={`/settings/templates?id=${f.templateId}`} className="text-sm font-medium text-primary hover:underline">Change the questions</Link>
              )}
            </div>
          </Field>

          <Field label="Colour in the calendar" htmlFor="at-col">
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={f.color.toLowerCase() === c} onClick={() => setF({ ...f, color: c })} className={cn('h-8 w-8 rounded-full border-2 transition-transform hover:scale-110', f.color.toLowerCase() === c ? 'border-foreground ring-2 ring-offset-2 ring-foreground/30' : 'border-transparent')} style={{ backgroundColor: c }} />
              ))}
              <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                Other <Input id="at-col" type="color" className="h-8 w-10 p-0.5" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
              </label>
            </div>
          </Field>

          <div className="grid gap-2">
            <Toggle label="A vet must be booked" hint="The appointment takes time in a vet’s diary. Switch off for things like nail trims done by staff." checked={f.requiresClinician} onChange={(v) => setF({ ...f, requiresClinician: v })} />
            {portal && <Toggle label="Clients can book it online" hint="Shown on your online booking page and in the client portal." checked={f.allowOnlineBooking} onChange={(v) => setF({ ...f, allowOnlineBooking: v })} />}
            {type && <Toggle label="Can be booked" hint="Switched off: hidden when booking; past appointments keep it." checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />}
          </div>
        </div>
        <DialogFooter>
          {type && <DeleteRecordButton className="text-destructive hover:text-destructive sm:mr-auto" name={type.name} path={`/appointment-types/${type.id}`} invalidate={[['appointment-types']]} onDeleted={() => onOpenChange(false)} />}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.name.trim() || priceInvalid || f.durationMinutes < 5} loading={save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
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
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<{ open: boolean; type: AppointmentType | null; key: number }>({ open: false, type: null, key: 0 });
  const [managing, setManaging] = useState(false);
  const toggle = useMutation({
    mutationFn: (t: AppointmentType) => api.patch(`/appointment-types/${t.id}`, { isActive: !t.isActive }),
    onSuccess: (_r, t) => {
      toast.success(`${t.name} ${t.isActive ? 'can no longer be booked' : 'can be booked again'}`);
      qc.invalidateQueries({ queryKey: ['appointment-types'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const types = q.data ?? [];
  // Grouped by the clinic's categories, in their order; types without one under their kind's name.
  const groupName = (t: AppointmentType) => t.categoryRef?.name ?? enumLabel(t.category);
  const groups = [...new Set(types.map(groupName))].map((name) => ({ name, rows: types.filter((t) => groupName(t) === name) }));
  // Dental procedure prices sit with the Dental appointment types (in their own Dental section when there is none).
  const moduleOn = useModuleOn();
  const dentalOn = moduleOn('dental');
  const dentalGroup = groups.find((g) => g.rows.some((t) => t.category === 'DENTAL'))?.name;
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Appointment types</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">What clients can be booked for — how long each takes, what is charged, and the questions the vet asks. In a consultation the vet picks the category, then the appointment type.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setManaging(true)}><Tags /> Categories</Button>
            <Button size="sm" onClick={() => setDlg({ open: true, type: null, key: Date.now() })}><Plus /> Add appointment type</Button>
          </div>
        </CardHeader>
        {q.isLoading ? (
          <LoadingRows rows={5} />
        ) : !types.length ? (
          <EmptyState icon={CalendarRange} title="No appointment types" description="Add at least one before booking appointments." />
        ) : (
          <div className="grid gap-5 p-4">
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h3 className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.name} <span className="font-normal normal-case tracking-normal">· {g.rows.length}</span>
                </h3>
                <ul className="divide-y rounded-xl border">
                  {g.rows.map((t) => (
                    <li key={t.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5', !t.isActive && 'bg-muted/40')}>
                      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDlg({ open: true, type: t, key: Date.now() })}>
                        <span className={cn('block truncate text-sm font-medium', !t.isActive && 'text-muted-foreground')}>{t.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.durationMinutes} min
                          {t.template && ` · ${questionsLabel(t.template._count?.questions ?? 0)}`}
                          {!t.requiresClinician && ' · no vet needed'}
                          {portal && t.allowOnlineBooking && ' · bookable online'}
                        </span>
                      </button>
                      <span className="text-right text-sm">
                        {t.service ? (
                          <>
                            <span className="tabular font-medium">{fmtMoney(t.service.priceMinor, currency)}</span>
                            <span className="block text-xs text-muted-foreground">{t.service.name}</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No charge</span>
                        )}
                      </span>
                      {t.template && (
                        <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
                          <Link href={`/settings/templates?id=${t.template.id}`} aria-label={`Questions for ${t.name}`}><MessageSquareText /> Questions</Link>
                        </Button>
                      )}
                      <Switch checked={t.isActive} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(t)} aria-label={`${t.name} can be booked`} />
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setDlg({ open: true, type: t, key: Date.now() })}><Edit /></Button>
                    </li>
                  ))}
                </ul>
                {dentalOn && g.name === dentalGroup && <DentalPricesPanel />}
              </section>
            ))}
            {dentalOn && !dentalGroup && (
              <section aria-label="Dental">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dental</h3>
                <DentalPricesPanel />
              </section>
            )}
          </div>
        )}
      </Card>
      <CategoriesDialog open={managing} onOpenChange={setManaging} />
      {dlg.open && <TypeDialog key={dlg.key} type={dlg.type} open={dlg.open} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />}
    </RequirePermission>
  );
}
