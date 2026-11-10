'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PATIENT_SEXES, TRIAGE_PRIORITIES, createClientSchema, enumLabel, type Paginated } from '@vcms/shared';
import { AlertTriangle, ArrowLeft, CalendarPlus, Check, ChevronRight, LogIn, PawPrint, Phone, Plus, Search, Stethoscope, UserPlus, UserRound, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import type { PickedPatient } from '../patients/patient-picker';
import { AlertChip } from '../status';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect } from '../ui/input';
import { Avatar } from '../ui/misc';
import { useAppointmentTypes, useClinicians } from '@/hooks/use-catalog';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api, qs } from '@/lib/api';
import { fmtAge, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { shiftDate, todayIn, zonedInstant } from '@/lib/time';
import type { Appointment, ClientRow, PatientRow, Species } from '@/lib/types';
import { cn } from '@/lib/utils';

type Step = 'who' | 'animal' | 'next';
type Action = 'queue' | 'book' | 'consult';
interface Owner {
  id: string;
  displayName: string;
  clientNo?: string;
  mobilePhone: string | null;
  balanceMinor?: number;
}

const looksLikePhone = (s: string) => /^[+\d\s()-]+$/.test(s) && s.replace(/\D/g, '').length >= 4;
/** "Bilal Hussain" → first name "Bilal", surname "Hussain"; a single name stays a first name. */
function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.length < 2 ? { firstName: parts[0] ?? '', lastName: '' } : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
export const toPicked = (p: PatientRow, owner: Owner): PickedPatient => ({
  id: p.id,
  name: p.name,
  patientNo: p.patientNo,
  species: p.species,
  owner: { id: owner.id, displayName: owner.displayName, mobilePhone: owner.mobilePhone },
  alerts: p.alerts,
});

function Steps({ step }: { step: Step }) {
  const all: { key: Step; label: string }[] = [
    { key: 'who', label: 'Owner' },
    { key: 'animal', label: 'Animal' },
    { key: 'next', label: 'Next step' },
  ];
  const at = all.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Steps">
      {all.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold', i < at ? 'bg-success text-white' : i === at ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} aria-current={i === at ? 'step' : undefined}>
            {i < at ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn('font-medium', i === at ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          {i < all.length - 1 && <span className="h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

/** Step 1: find the owner by name and mobile number, or register a new one. */
function FindOwner({ onPick }: { onPick: (o: Owner, isNew: boolean) => void }) {
  const { session, can } = useSession();
  const [qName, setQName] = useState('');
  const [qPhone, setQPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const nameTerm = useDebounce(qName.trim(), 250);
  const phoneTerm = useDebounce(qPhone.trim(), 250);
  // The mobile number finds the client exactly; the name when no number is typed.
  const byPhone = phoneTerm.replace(/\D/g, '').length >= 4;
  const term = byPhone ? phoneTerm : nameTerm.length >= 2 ? nameTerm : '';
  const results = useQuery({
    queryKey: ['new-visit', 'clients', term],
    queryFn: () => api.get<Paginated<ClientRow>>(`/clients${qs({ q: term, pageSize: 8, status: 'ACTIVE' })}`),
    enabled: !!term,
    placeholderData: (p) => p,
  });
  // Both typed: clients matching the name too come first.
  const nameMatch = (c: ClientRow) => !!nameTerm && c.displayName.toLowerCase().includes(nameTerm.toLowerCase());
  const rows = term ? [...(results.data?.data ?? [])].sort((a, b) => (byPhone && nameTerm ? Number(nameMatch(b)) - Number(nameMatch(a)) : 0)) : [];
  const searched = [nameTerm, phoneTerm].filter(Boolean).join(' · ');
  // New client
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const phoneKey = useDebounce(mobile.replace(/\D/g, ''), 400);
  const dupes = useQuery({
    queryKey: ['client-dupes', 'new-visit', phoneKey],
    queryFn: () => api.post<{ id: string; displayName: string; clientNo: string }[]>('/clients/duplicates', { mobilePhone: phoneKey }),
    enabled: adding && phoneKey.length >= 10,
  });
  const startAdding = () => {
    setAdding(true);
    setName(looksLikePhone(qName) ? '' : qName.trim());
    setMobile(qPhone.trim() || (looksLikePhone(qName) ? qName.trim() : ''));
  };
  const save = useMutation({
    mutationFn: () =>
      api.post<Owner>('/clients', {
        type: 'INDIVIDUAL',
        ...splitName(name),
        mobilePhone: mobile.trim(),
        email: email.trim() || null,
        preferredChannel: session.organization?.country === 'PK' ? 'WHATSAPP' : 'SMS',
        primaryBranchId: session.branch?.id ?? null,
      }),
    onSuccess: (c) => {
      toast.success(`Client registered: ${c.displayName}${c.clientNo ? ` (${c.clientNo})` : ''}`);
      onPick(c, true);
    },
    onError: (e: Error) => setError(e.message),
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter the owner’s name';
    if (!mobile.trim()) next.mobile = 'Enter the mobile number';
    const parsed = createClientSchema.safeParse({ type: 'INDIVIDUAL', ...splitName(name), mobilePhone: mobile.trim(), email: email.trim() || null, preferredChannel: 'SMS' });
    if (!parsed.success) for (const i of parsed.error.issues) next[i.path[0] === 'mobilePhone' ? 'mobile' : i.path[0] === 'email' ? 'email' : 'name'] ??= i.message;
    setErrors(next);
    setError(null);
    if (!Object.keys(next).length) save.mutate();
  };

  if (adding) {
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to the search" onClick={() => setAdding(false)}>
            <ArrowLeft />
          </Button>
          <div>
            <p className="text-sm font-semibold">Register a new client</p>
            <p className="text-xs text-muted-foreground">The owner first; you add their animal next.</p>
          </div>
        </div>
        {error && <FormError message={error} />}
        {!!dupes.data?.length && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="grid gap-1.5">
              <p>This mobile number is already registered:</p>
              <div className="flex flex-wrap gap-1.5">
                {dupes.data.map((d) => (
                  <Button key={d.id} type="button" size="sm" variant="outline" className="h-7" onClick={() => onPick({ id: d.id, displayName: d.displayName, clientNo: d.clientNo, mobilePhone: mobile.trim() }, false)}>
                    Use {d.displayName} ({d.clientNo})
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" htmlFor="nv-name" required error={errors.name} className="sm:col-span-2">
            <Input id="nv-name" autoFocus autoComplete="off" placeholder="e.g. Bilal Hussain" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile" htmlFor="nv-mobile" required error={errors.mobile}>
            <Input id="nv-mobile" type="tel" inputMode="tel" placeholder="0300 1234567" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Field label="Email (optional)" htmlFor="nv-email" error={errors.email}>
            <Input id="nv-email" type="email" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button type="button" loading={save.isPending} onClick={submit}>
            Save and continue <ChevronRight />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Field label="Owner’s name" htmlFor="nv-q-name">
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="nv-q-name" autoFocus autoComplete="off" placeholder="e.g. Bilal Hussain" className="h-11 rounded-xl pl-10" value={qName} onChange={(e) => setQName(e.target.value)} />
          </div>
        </Field>
        <Field label="Mobile number" htmlFor="nv-q-phone">
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="nv-q-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="0300 1234567" className="h-11 rounded-xl pl-10" value={qPhone} onChange={(e) => setQPhone(e.target.value)} />
          </div>
        </Field>
      </div>
      {!term ? (
        <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          <Search className="h-4 w-4" /> Type the owner’s name and mobile number to find them.
        </p>
      ) : rows.length ? (
        <ul className="grid max-h-[340px] gap-1.5 overflow-y-auto" aria-label="Clients found">
          {rows.map((c) => {
            const pets = c.patients.filter((p) => p.status === 'ACTIVE');
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick({ id: c.id, displayName: c.displayName, clientNo: c.clientNo, mobilePhone: c.mobilePhone, balanceMinor: c.balanceMinor }, false)}
                  className="flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  <Avatar name={c.displayName} className="h-10 w-10 text-xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.displayName}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">{c.clientNo}</span>
                      {c.mobilePhone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {c.mobilePhone}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {pets.length ? (
                        pets.slice(0, 4).map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                            <PawPrint className="h-3 w-3 text-primary" />
                            {p.name} <span className="font-normal text-muted-foreground">{p.species}</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground">No animals registered yet</span>
                      )}
                      {pets.length > 4 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{pets.length - 4}</span>}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : results.isFetching ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">Searching…</p>
      ) : (
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <p className="text-sm font-medium">No client found for “{searched}”</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Check the spelling or the number, or register them as a new client.</p>
        </div>
      )}
      {can('clients.write') && (
        <Button type="button" variant="outline" className="justify-start border-dashed" onClick={startAdding}>
          <UserPlus /> Register a new client{term && !rows.length && nameTerm ? ` “${nameTerm}”` : ''}
        </Button>
      )}
    </div>
  );
}

/** Step 2: which of the owner's animals the visit is for, or add a new one. */
function ChooseAnimal({ owner, startAdding, onPick, onBack }: { owner: Owner; startAdding: boolean; onPick: (p: PickedPatient) => void; onBack: () => void }) {
  const { session, can, currency } = useSession();
  const qc = useQueryClient();
  const pets = useQuery({
    queryKey: ['new-visit', 'pets', owner.id],
    queryFn: () => api.get<Paginated<PatientRow>>(`/patients${qs({ ownerId: owner.id, status: 'ACTIVE', pageSize: 50 })}`),
  });
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), staleTime: 300_000 });
  const grouped = (species.data ?? []).reduce<Record<string, Species[]>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});
  const rows = pets.data?.data ?? [];
  const [adding, setAdding] = useState(startAdding);
  useEffect(() => {
    if (pets.isSuccess && !rows.length && can('patients.write')) setAdding(true);
  }, [pets.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const [sex, setSex] = useState('UNKNOWN');
  const [dob, setDob] = useState('');
  const [breed, setBreed] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post<PatientRow>('/patients', {
        ownerId: owner.id,
        name: name.trim(),
        speciesId,
        sex,
        breedText: breed.trim() || undefined,
        dateOfBirth: dob || undefined,
        dobEstimated: false,
        identifiers: [],
        primaryBranchId: session.branch?.id ?? null,
      }),
    onSuccess: (p) => {
      const sp = species.data?.find((s) => s.id === speciesId);
      toast.success(`${p.name} registered (${p.patientNo}) for ${owner.displayName}`);
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient-picker'] });
      onPick({ id: p.id, name: p.name, patientNo: p.patientNo, species: { id: speciesId, name: sp?.name ?? '', category: sp?.category ?? '' }, owner: { id: owner.id, displayName: owner.displayName, mobilePhone: owner.mobilePhone }, alerts: [] });
    },
    onError: (e: Error) => setError(e instanceof ApiError ? e.message : 'The animal could not be saved'),
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter the animal’s name';
    if (!speciesId) next.speciesId = 'Choose the species';
    setErrors(next);
    setError(null);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
        <Avatar name={owner.displayName} className="h-10 w-10 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{owner.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{[owner.clientNo, owner.mobilePhone].filter(Boolean).join(' · ')}</p>
        </div>
        {!!owner.balanceMinor && owner.balanceMinor > 0 && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Owes {fmtMoney(owner.balanceMinor, currency)}</span>}
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Change
        </Button>
      </div>

      {!adding && <p className="text-sm font-semibold">Which animal is this visit for?</p>}
      {pets.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading their animals…</p>
      ) : (
        !adding && (
          <ul className="grid max-h-[320px] gap-2 overflow-y-auto sm:grid-cols-2" aria-label="Their animals">
            {rows.map((p) => {
              const critical = p.alerts.find((a) => a.severity === 'CRITICAL');
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(toPicked(p, owner))} className="flex h-full w-full items-start gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]" aria-label={`Visit for ${p.name}`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <PawPrint className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[p.species.name, p.breed, p.sex !== 'UNKNOWN' ? enumLabel(p.sex) : null, p.dateOfBirth ? fmtAge(p.dateOfBirth, p.dobEstimated) : null].filter(Boolean).join(' · ')}</span>
                      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{p.patientNo}</span>
                      {critical && <span className="mt-1 block"><AlertChip alert={critical} /></span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {can('patients.write') && (
              <li>
                <button type="button" onClick={() => setAdding(true)} className="flex h-full min-h-[76px] w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/[0.03]">
                  <Plus className="h-4 w-4" /> Add a new animal
                </button>
              </li>
            )}
          </ul>
        )
      )}

      {adding && (
        <div className="grid gap-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{rows.length ? 'Add a new animal' : `${owner.displayName} has no animals yet — add the first one`}</p>
            {rows.length > 0 && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setAdding(false)}>
                <X />
              </Button>
            )}
          </div>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Animal’s name" htmlFor="nv-pet" required error={errors.name}>
              <Input id="nv-pet" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Species" htmlFor="nv-species" required error={errors.speciesId}>
              <NativeSelect id="nv-species" value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
                <option value="">Choose…</option>
                {Object.entries(grouped).map(([cat, list]) => (
                  <optgroup key={cat} label={enumLabel(cat)}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Sex" htmlFor="nv-sex">
              <NativeSelect id="nv-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
                {PATIENT_SEXES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'UNKNOWN' ? 'Not known' : enumLabel(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Date of birth (optional)" htmlFor="nv-dob">
              <Input id="nv-dob" type="date" max={new Date().toISOString().slice(0, 10)} value={dob} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Breed (optional)" htmlFor="nv-breed" className="sm:col-span-2">
              <Input id="nv-breed" placeholder="e.g. German Shepherd" value={breed} onChange={(e) => setBreed(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="button" loading={save.isPending} onClick={submit}>
              Save and continue <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Step 3: what happens now — the waiting queue, a booking, or straight into the consultation. */
function NextStep({ patient, initialAction, allowConsult, onBack, onBook, onDone }: { patient: PickedPatient; initialAction?: Action; allowConsult: boolean; onBack: () => void; onBook: (p: PickedPatient) => void; onDone: () => void }) {
  const { session, can } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const tz = session.branch?.timezone ?? 'UTC';
  const types = useAppointmentTypes();
  const clinicians = useClinicians(session.branch?.id);
  const actions = [
    can('appointments.checkin') && { key: 'queue' as const, icon: LogIn, title: 'Add to waiting queue', hint: 'Check in now; the vet sees them in turn' },
    can('appointments.write') && { key: 'book' as const, icon: CalendarPlus, title: 'Book an appointment', hint: 'Choose a day and time for a later visit' },
    allowConsult && can('clinical.write') && { key: 'consult' as const, icon: Stethoscope, title: 'Start consultation now', hint: 'Open the consultation straight away' },
  ].filter(Boolean) as { key: Action; icon: React.ComponentType<{ className?: string }>; title: string; hint: string }[];
  const [action, setAction] = useState<Action | undefined>(initialAction && actions.some((a) => a.key === initialAction) ? initialAction : actions[0]?.key);
  // Queue
  const [typeId, setTypeId] = useState('');
  const [clinicianId, setClinicianId] = useState('');
  const [priority, setPriority] = useState('');
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chooseType = (id: string) => {
    setTypeId(id);
    if (!priorityTouched) setPriority(types.data?.find((t) => t.id === id)?.category === 'EMERGENCY' ? 'EMERGENT' : '');
  };
  const checkIn = useMutation({
    mutationFn: () =>
      api.post<Appointment>('/front-desk/walk-in', {
        branchId: session.branch!.id,
        clientId: patient.owner!.id,
        patientId: patient.id,
        appointmentTypeId: typeId || types.data![0].id,
        clinicianId: clinicianId || null,
        priority: priority || undefined,
        reason,
      }),
    onSuccess: (a) => {
      toast.success(`Checked in: ${a.patient?.name ?? a.client.displayName} as a walk-in (${a.appointmentNo})${a.tokenNumber ? ` · token ${a.tokenNumber}` : ''}`);
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  // Consultation: a patient already waiting today is started from that check-in, so the queue stays linked.
  const today = todayIn(tz);
  const waiting = useQuery({
    queryKey: ['appointments', 'checked-in', patient.id, today],
    queryFn: () => api.get<Appointment[]>(`/appointments${qs({ patientId: patient.id, status: 'CHECKED_IN', from: zonedInstant(today, 0, tz).toISOString(), to: zonedInstant(shiftDate(today, 1), 0, tz).toISOString() })}`),
    enabled: can('appointments.read'),
  });
  const waitingAppt = waiting.data?.[0] ?? null;
  const [complaint, setComplaint] = useState('');
  const consult = useMutation({
    mutationFn: async () => {
      if (waitingAppt) {
        const a = await api.post<Appointment & { encounterId: string | null }>(`/appointments/${waitingAppt.id}/status`, { action: 'start' });
        return a.encounterId;
      }
      return (await api.post<{ id: string }>('/encounters', { patientId: patient.id, type: 'CONSULTATION', chiefComplaint: complaint })).id;
    },
    onSuccess: (id) => {
      if (!id) return void toast.error('The consultation could not be opened');
      onDone();
      router.push(`/consultations/${id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <PawPrint className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {patient.name} <span className="font-normal text-muted-foreground">· {patient.species.name}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {patient.owner?.displayName}
            {patient.owner?.mobilePhone ? ` · ${patient.owner.mobilePhone}` : ''} · {patient.patientNo}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Change
        </Button>
      </div>
      {patient.alerts.filter((a) => a.severity === 'CRITICAL').length > 0 && (
        <div className="flex flex-wrap gap-1.5">{patient.alerts.filter((a) => a.severity === 'CRITICAL').map((a) => <AlertChip key={a.id} alert={a} />)}</div>
      )}

      <p className="text-sm font-semibold">What would you like to do?</p>
      <div className={cn('grid gap-2', actions.length >= 3 ? 'sm:grid-cols-3' : actions.length === 2 ? 'sm:grid-cols-2' : '')} role="radiogroup" aria-label="Next step">
        {actions.map((a) => {
          const on = action === a.key;
          return (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setError(null);
                if (a.key === 'book') return onBook(patient);
                setAction(a.key);
              }}
              className={cn('flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all', on ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/40' : 'bg-background hover:border-primary/40')}
            >
              <span className={cn('grid h-9 w-9 place-items-center rounded-lg', on ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                <a.icon className="h-[18px] w-[18px]" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{a.title}</span>
                <span className="block text-xs text-muted-foreground">{a.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <FormError message={error} />}

      {action === 'queue' && (
        <div className="grid gap-3 rounded-xl border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Visit type" htmlFor="wi-t">
              <NativeSelect id="wi-t" value={typeId} onChange={(e) => chooseType(e.target.value)}>
                {types.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Vet" htmlFor="wi-c">
              <NativeSelect id="wi-c" value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
                <option value="">Any vet (first free)</option>
                {clinicians.data?.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="How urgent? (a vet will check)" htmlFor="wi-pr">
              <NativeSelect id="wi-pr" value={priority} onChange={(e) => { setPriority(e.target.value); setPriorityTouched(true); }}>
                <option value="">Don’t know yet</option>
                {TRIAGE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {enumLabel(p)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Reason for the visit" htmlFor="wi-r">
              <Input id="wi-r" placeholder="e.g. Vomiting since last night" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="button" disabled={!patient.owner || !types.data?.length} loading={checkIn.isPending} onClick={() => { setError(null); checkIn.mutate(); }}>
              <LogIn /> Check in
            </Button>
          </div>
        </div>
      )}

      {action === 'consult' && (
        <div className="grid gap-3 rounded-xl border p-4">
          {waitingAppt ? (
            <p className="text-sm">
              <b>{patient.name}</b> is already in the waiting room{waitingAppt.reason ? ` (${waitingAppt.reason})` : ''}. The consultation starts from that check-in.
            </p>
          ) : (
            <Field label="Why is the animal here today?" htmlFor="nv-complaint" hint="Optional — the vet can write it in the consultation.">
              <Input id="nv-complaint" placeholder="e.g. Limping on the left hind leg" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
            </Field>
          )}
          <div className="flex justify-end">
            <Button type="button" loading={consult.isPending} onClick={() => { setError(null); consult.mutate(); }}>
              <Stethoscope /> Start consultation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * New visit at the front desk, in three steps: find the owner by name or mobile (or register them), choose which of
 * their animals the visit is for (or add one), then send it to the waiting queue, book an appointment, or start the
 * consultation straight away.
 */
export function NewVisitDialog({
  open,
  onOpenChange,
  initialPatient,
  initialAction,
  allowConsult = true,
  onBook,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Skip to the next step for this patient (e.g. just registered). */
  initialPatient?: PickedPatient | null;
  initialAction?: Action;
  /** Offer "Start consultation now" (not on the front desk, where consultations are not started). */
  allowConsult?: boolean;
  /** Book an appointment for the chosen patient (the booking window opens). */
  onBook: (p: PickedPatient) => void;
}) {
  const [step, setStep] = useState<Step>('who');
  const [owner, setOwner] = useState<Owner | null>(null);
  const [ownerIsNew, setOwnerIsNew] = useState(false);
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  useEffect(() => {
    if (!open) return;
    if (initialPatient?.owner) {
      setOwner({ id: initialPatient.owner.id, displayName: initialPatient.owner.displayName, mobilePhone: initialPatient.owner.mobilePhone ?? null });
      setPatient(initialPatient);
      setStep('next');
    } else {
      setOwner(null);
      setPatient(null);
      setStep('who');
    }
  }, [open, initialPatient]);
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New visit</DialogTitle>
          <DialogDescription>Find the owner, choose the animal, then {allowConsult ? 'send them to the queue, book a time, or start the consultation.' : 'send them to the waiting queue or book a time.'}</DialogDescription>
        </DialogHeader>
        <Steps step={step} />
        {step === 'who' && (
          <FindOwner
            onPick={(o, isNew) => {
              setOwner(o);
              setOwnerIsNew(isNew);
              setStep('animal');
            }}
          />
        )}
        {step === 'animal' && owner && (
          <ChooseAnimal
            owner={owner}
            startAdding={ownerIsNew}
            onBack={() => setStep('who')}
            onPick={(p) => {
              setPatient(p);
              setStep('next');
            }}
          />
        )}
        {step === 'next' && patient && (
          <NextStep
            patient={patient}
            initialAction={initialAction}
            allowConsult={allowConsult}
            onBack={() => setStep(owner ? 'animal' : 'who')}
            onBook={(p) => {
              close();
              onBook(p);
            }}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
