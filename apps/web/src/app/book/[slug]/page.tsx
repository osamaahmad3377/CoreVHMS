'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingIcs, publicBookingSchema, publicLookupSchema } from '@vcms/shared';
import {
  Ambulance,
  ArrowLeft,
  ArrowRight,
  Bath,
  Bug,
  Building2,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  FlaskConical,
  Home,
  MapPin,
  PawPrint,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Smile,
  Stethoscope,
  Syringe,
  Truck,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BookingFrame } from '@/components/booking/booking-frame';
import type { BookingInfo, BookingSummary, FreeTime } from '@/components/booking/booking-types';
import { SlotPicker } from '@/components/booking/slot-picker';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';

type Step = 'you' | 'pet' | 'service' | 'time' | 'details' | 'done';
const STEPS: { key: Exclude<Step, 'done'>; label: string }[] = [
  { key: 'you', label: 'You' },
  { key: 'pet', label: 'Pet' },
  { key: 'service', label: 'Visit' },
  { key: 'time', label: 'Day & time' },
  { key: 'details', label: 'Confirm' },
];

/** The client, as the clinic knows them (only when their name and mobile number both match). */
interface Me {
  known: boolean;
  firstName: string | null;
  pets: { id: string; name: string; species: string }[];
  allowNewClients: boolean;
}

/** Saves the .ics so the visit lands in the client's own phone calendar. */
function downloadIcs(b: BookingSummary, clinic: string) {
  const home = b.location === 'HOME';
  const ics = bookingIcs({
    uid: `${b.id}@nextcore`,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    title: `${b.service}${b.petName ? ` — ${b.petName}` : ''} ${home ? `home visit from ${clinic}` : `at ${clinic}`}`,
    location: home ? (b.visitAddress ?? '') : [b.branch.name, b.branch.address].filter(Boolean).join(', '),
    description: b.vet ? `With ${b.vet}` : null,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'appointment.ics',
  });
  a.click();
  URL.revokeObjectURL(url);
}

function Progress({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Booking steps">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors',
              i < at ? 'bg-success text-white' : i === at ? 'bg-primary text-primary-foreground shadow-glow' : 'bg-foreground/[0.07] text-muted-foreground',
            )}
            aria-current={i === at ? 'step' : undefined}
          >
            {i < at ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cn('hidden text-sm font-medium sm:block', i === at ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={cn('h-0.5 flex-1 rounded-full', i < at ? 'bg-success/60' : 'bg-foreground/10')} />}
        </li>
      ))}
    </ol>
  );
}

/** An icon for each kind of service. */
const KIND_ICON: Record<string, LucideIcon> = {
  CONSULTATION: Stethoscope,
  VACCINATION: Syringe,
  FOLLOW_UP: RotateCcw,
  SURGERY: Scissors,
  DENTAL: Smile,
  DIAGNOSTICS: FlaskConical,
  GROOMING: Bath,
  EMERGENCY: Ambulance,
  FIELD_VISIT: Truck,
  OTHER: PawPrint,
};

/**
 * What clients choose from: the clinic's categories, in its order (as in step 1 of the consultation). Each is booked
 * as one appointment type — the one chosen in the settings (the one named like the category, else the first).
 */
function bookableCategories(types: BookingInfo['appointmentTypes']) {
  const groups: {
    name: string;
    kind: string;
    sort: number;
    types: BookingInfo['appointmentTypes'];
  }[] = [];
  for (const t of types) {
    const g = groups.find((x) => x.name === t.categoryName);
    if (g) g.types.push(t);
    else
      groups.push({
        name: t.categoryName,
        kind: t.category,
        sort: t.categorySort,
        types: [t],
      });
  }
  return groups
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((g) => ({
      ...g,
      type: g.types.find((t) => t.name.toLowerCase() === g.name.toLowerCase()) ?? g.types[0],
    }));
}

/** The chosen visit, shown beside the details form and on the confirmation. */
function Summary({
  rows,
}: {
  rows: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
  }[];
}) {
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.label} className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <r.icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">{r.label}</span>
            <span className="block text-sm font-semibold">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['public-booking', slug],
    queryFn: () => api.get<BookingInfo>(`/public/booking/${slug}`),
    retry: false,
  });
  const [step, setStep] = useState<Step>('you');
  const [me, setMe] = useState<Me | null>(null);
  /** The pet chosen from their own; '' = a new pet (name and kind below). */
  const [petId, setPetId] = useState('');
  const [branchId, setBranchId] = useState('');
  /** The categories chosen (as the appointment type each is booked as), in the order chosen: the first is the main one. */
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [vetId, setVetId] = useState('');
  /** At the clinic or a home visit — asked first when the clinic offers home visits online. */
  const [where, setWhere] = useState<'CLINIC' | 'HOME' | null>(null);
  const [time, setTime] = useState<FreeTime | null>(null);
  const [f, setF] = useState({
    ownerName: '',
    mobilePhone: '',
    email: '',
    petName: '',
    speciesId: '',
    reason: '',
    website: '',
    visitAddress: '',
    visitDirections: '',
    visitMapUrl: '',
  });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(BookingSummary & { manageLink: string }) | null>(null);

  const d = info.data;
  const branch = d?.branches.find((b) => b.id === branchId) ?? (d?.branches.length === 1 ? d.branches[0] : undefined);
  const chosen = typeIds.map((id) => d?.appointmentTypes.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  const type = chosen[0];
  const extraTypeIds = chosen.slice(1).map((t) => t.id);
  const totalMinutes = chosen.reduce((n, t) => n + t.durationMinutes, 0);
  const categoryOf = (id: string) => d?.appointmentTypes.find((t) => t.id === id)?.categoryName;
  const visitName = chosen.map((t) => categoryOf(t.id) ?? t.name).join(' + ');
  const toggleType = (id: string) => {
    setTypeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setTime(null);
  };
  const vets = useMemo(() => (d?.clinicians ?? []).filter((c) => !!branch && c.branchIds.includes(branch.id)), [d, branch]);
  const vet = vets.find((v) => v.id === vetId);
  const tz = branch?.timezone ?? 'UTC';
  const homeOffered = !!d?.settings.allowHomeVisits;
  const location = homeOffered ? where : 'CLINIC';
  const home = location === 'HOME';
  // The address is asked only for a home visit.
  const visit = home
    ? {
        location,
        visitAddress: f.visitAddress,
        visitDirections: f.visitDirections,
        visitMapUrl: f.visitMapUrl,
      }
    : { location: 'CLINIC' as const };
  const { visitAddress: _a, visitDirections: _d, visitMapUrl: _m, ...person } = f;

  // A pet chosen from their own needs no name or kind; a new one does.
  const pet = petId ? { patientId: petId, petName: '', speciesId: '' } : { patientId: '' };
  const chosenPet = me?.pets.find((p) => p.id === petId);
  const petLabel = chosenPet ? `${chosenPet.name} · ${chosenPet.species}` : [f.petName.trim(), d?.species.find((s) => s.id === f.speciesId)?.name].filter(Boolean).join(' · ');
  const youCheck = publicLookupSchema.safeParse({ ownerName: f.ownerName, mobilePhone: f.mobilePhone });
  const youErrs: Record<string, string | undefined> = {};
  if (!youCheck.success) for (const i of youCheck.error.issues) youErrs[String(i.path[0])] ??= i.message;
  const [triedYou, setTriedYou] = useState(false);
  const [triedPet, setTriedPet] = useState(false);
  const lookup = useMutation({
    mutationFn: () => api.post<Me>(`/public/booking/${slug}/lookup`, { ownerName: f.ownerName, mobilePhone: f.mobilePhone }),
    onSuccess: (r) => {
      setMe(r);
      // Back with the same pet if it is still theirs; otherwise their first pet (or a new one).
      setPetId((id) => (r.pets.some((p) => p.id === id) ? id : (r.pets[0]?.id ?? '')));
      setError(null);
      setStep('pet');
    },
    onError: (e: Error) => setError(e.message),
  });

  const parsed = publicBookingSchema.safeParse({
    ...person,
    ...pet,
    ...visit,
    branchId: branch?.id,
    appointmentTypeId: type?.id,
    extraTypeIds,
    clinicianId: vetId,
    startsAt: time?.startsAt,
  });
  const errs: Record<string, string | undefined> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;

  const book = useMutation({
    mutationFn: () =>
      api.post<BookingSummary & { manageLink: string }>(`/public/booking/${slug}`, {
        ...person,
        ...pet,
        ...visit,
        branchId: branch!.id,
        appointmentTypeId: type!.id,
        extraTypeIds,
        clinicianId: vetId,
        startsAt: time!.startsAt,
      }),
    onSuccess: (r) => {
      setDone(r);
      setStep('done');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.details && (e.details as { code?: string }).code === 'SLOT_TAKEN') {
        setTime(null);
        setStep('time');
        qc.invalidateQueries({ queryKey: ['public-slots'] });
        qc.invalidateQueries({ queryKey: ['public-days'] });
      }
      setError(e.message);
    },
  });

  if (info.isLoading)
    return (
      <div className="app-canvas min-h-screen p-6">
        <LoadingRows rows={6} className="mx-auto max-w-3xl" />
      </div>
    );
  if (info.error || !d)
    return (
      <div className="app-canvas grid min-h-screen place-items-center p-6">
        <div className="surface-strong max-w-md rounded-2xl p-8 text-center">
          <CalendarCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Online booking is not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">This booking page is switched off or the address is not right. Please call the clinic to book.</p>
        </div>
      </div>
    );

  const logo = d.clinic.branding.logoUrl;
  // Clients choose categories only — one or several for the same visit.
  const categories = bookableCategories(d.appointmentTypes);
  const when = time ? `${branchTime(time.startsAt, tz, 'EEEE d MMMM')} at ${branchTime(time.startsAt, tz, 'h:mm a')}` : '';
  const summaryRows = [
    { icon: User, label: 'You', value: [f.ownerName.trim(), f.mobilePhone.trim()].filter(Boolean).join(' · ') },
    petLabel && { icon: PawPrint, label: 'Pet', value: petLabel },
    type && {
      icon: Stethoscope,
      label: chosen.length > 1 ? 'Services' : 'Service',
      value: `${visitName} · ${totalMinutes} min`,
    },
    time && { icon: Clock, label: 'When', value: when },
    {
      icon: User,
      label: 'Vet',
      value: vet?.name ?? (time && time.clinicianIds.length ? 'First free vet' : 'Any vet'),
    },
    home
      ? {
          icon: Home,
          label: 'Where',
          value: f.visitAddress.trim() ? `Home visit · ${f.visitAddress.trim()}` : 'Home visit',
        }
      : branch &&
        d.branches.length > 1 && {
          icon: CalendarCheck,
          label: 'Where',
          value: branch.name,
        },
  ].filter(Boolean) as {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
  }[];

  return (
    <BookingFrame name={d.clinic.name} branding={d.clinic.branding} logoSrc={logo} address={branch?.address ?? null} phone={branch?.phone ?? d.clinic.phone}>
      {step !== 'done' && (
        <>
          <div className="mb-6">
            <h2 className="text-[1.75rem] font-bold tracking-tight sm:text-4xl">Book an appointment</h2>
            <p className="mt-1 text-muted-foreground">{d.settings.welcomeMessage || 'Choose what you need and a time that suits you. It takes about a minute.'}</p>
          </div>
          <Progress step={step} />
        </>
      )}

      {step === 'you' && (
        <form
          className="surface mx-auto grid w-full max-w-xl gap-5 rounded-2xl p-5 sm:p-8"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTriedYou(true);
            setError(null);
            if (youCheck.success) lookup.mutate();
          }}
        >
          <div>
            <h3 className="text-lg font-semibold">About you</h3>
            <p className="text-sm text-muted-foreground">Your name and mobile number. If you have been to us before, we’ll find your pets.</p>
          </div>
          {error && <FormError message={error} />}
          <Field label="Your name" htmlFor="b-name" required error={triedYou ? youErrs.ownerName : undefined}>
            <Input id="b-name" autoFocus autoComplete="name" placeholder="e.g. Sana Malik" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} aria-invalid={triedYou && !!youErrs.ownerName} />
          </Field>
          <Field label="Mobile (WhatsApp)" htmlFor="b-phone" required hint="We send your confirmation here." error={triedYou ? youErrs.mobilePhone : undefined}>
            <Input id="b-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" value={f.mobilePhone} onChange={(e) => setF({ ...f, mobilePhone: e.target.value })} aria-invalid={triedYou && !!youErrs.mobilePhone} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" size="lg" className="w-full sm:w-auto" loading={lookup.isPending}>
              Continue <ArrowRight />
            </Button>
          </div>
        </form>
      )}

      {step === 'pet' && me && (
        <div className="surface mx-auto grid w-full max-w-2xl gap-5 rounded-2xl p-5 sm:p-8">
          {me.known ? (
            <div>
              <h3 className="text-lg font-semibold">Welcome back{me.firstName ? `, ${me.firstName}` : ''}!</h3>
              <p className="text-sm text-muted-foreground">Which pet is this visit for?</p>
            </div>
          ) : (
            <div>
              <h3 className="text-lg font-semibold">Your pet</h3>
              <p className="text-sm text-muted-foreground">Tell us who is coming to see us.</p>
            </div>
          )}
          {!me.known && !me.allowNewClients ? (
            <div className="grid gap-3 rounded-2xl bg-warning/10 p-4 text-sm ring-1 ring-inset ring-warning/25">
              <p>
                We couldn’t find a registration with this name and mobile number. Online booking is for clients already registered with the clinic — please check the
                spelling and the number, or call {d.clinic.phone ?? 'the clinic'} to book your first visit.
              </p>
            </div>
          ) : (
            <>
              {me.known && (
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Which pet">
                  {me.pets.map((p) => {
                    const on = petId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setPetId(p.id)}
                        className={cn('flex items-center gap-3 rounded-2xl p-4 text-left transition-all duration-200 ease-apple', on ? 'bg-primary/10 ring-2 ring-primary' : 'surface-flat hover:-translate-y-0.5')}
                      >
                        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', on ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                          <PawPrint className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{p.name}</span>
                          <span className="block text-sm text-muted-foreground">{p.species}</span>
                        </span>
                        {on && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={petId === ''}
                    onClick={() => setPetId('')}
                    className={cn('flex items-center gap-3 rounded-2xl border-2 border-dashed p-4 text-left transition-all duration-200 ease-apple', petId === '' ? 'border-primary bg-primary/[0.06]' : 'border-border hover:border-primary/40')}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="font-semibold">{me.pets.length ? 'Another pet' : 'Add your pet'}</span>
                  </button>
                </div>
              )}
              {petId === '' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Pet’s name" htmlFor="b-pet" required error={triedPet ? errs.petName : undefined}>
                    <Input id="b-pet" value={f.petName} onChange={(e) => setF({ ...f, petName: e.target.value })} aria-invalid={triedPet && !!errs.petName} />
                  </Field>
                  <Field label="Kind of animal" htmlFor="b-species" required error={triedPet ? errs.speciesId : undefined}>
                    <NativeSelect id="b-species" value={f.speciesId} onChange={(e) => setF({ ...f, speciesId: e.target.value })} aria-invalid={triedPet && !!errs.speciesId}>
                      <option value="">Choose…</option>
                      {d.species.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              )}
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setStep('you')}>
              <ArrowLeft /> Back
            </Button>
            {(me.known || me.allowNewClients) && (
              <Button
                size="lg"
                onClick={() => {
                  setTriedPet(true);
                  if (!petId && (errs.petName || errs.speciesId)) return;
                  setStep('service');
                }}
              >
                Continue <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'service' && (
        <div className="surface grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl p-5 sm:p-8">
          {homeOffered && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">Where would you like the visit?</h3>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where would you like the visit?">
                {[
                  {
                    key: 'CLINIC' as const,
                    icon: Building2,
                    title: 'At the clinic',
                    hint: 'Bring your pet to one of our branches',
                  },
                  {
                    key: 'HOME' as const,
                    icon: Home,
                    title: 'Home visit',
                    hint: 'A vet comes to your home',
                  },
                ].map((o) => {
                  const on = where === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setWhere(o.key);
                        setTime(null);
                      }}
                      className={cn('flex items-center gap-3 rounded-2xl p-4 text-left transition-all duration-200 ease-apple', on ? 'bg-primary/10 ring-2 ring-primary' : 'surface-flat hover:-translate-y-0.5')}
                    >
                      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', on ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                        <o.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{o.title}</span>
                        <span className="block text-sm text-muted-foreground">{o.hint}</span>
                      </span>
                      {on && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {location && d.branches.length > 1 && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">{home ? 'Which branch is nearest to you?' : 'Which branch?'}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {d.branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    disabled={!b.vetCount}
                    onClick={() => {
                      setBranchId(b.id);
                      setVetId('');
                      setTime(null);
                    }}
                    className={cn(
                      'rounded-2xl p-4 text-left transition-all duration-200 ease-apple disabled:cursor-not-allowed disabled:opacity-60',
                      branch?.id === b.id ? 'bg-primary/10 ring-2 ring-primary' : 'surface-flat enabled:hover:-translate-y-0.5',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold">{b.name}</span>
                      {branch?.id === b.id && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                    </span>
                    {b.address && <span className="block text-sm text-muted-foreground">{b.address}</span>}
                    <span className="mt-1 block text-xs font-medium text-muted-foreground">
                      {b.vetCount ? `${b.vetCount} ${b.vetCount === 1 ? 'vet' : 'vets'} available` : `Not bookable online yet${b.phone ? ` — call ${b.phone}` : ''}`}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {location && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">What is the visit for?</h3>
              {categories.length && d.branches.length ? (
                <>
                  <p className="-mt-1 text-sm text-muted-foreground">Tap everything you need — you can choose more than one.</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
                    {categories.map((c) => {
                      const Icon = /deworm/i.test(c.name) ? Bug : (KIND_ICON[c.kind] ?? PawPrint);
                      const on = typeIds.includes(c.type.id);
                      return (
                        <button
                          key={c.name}
                          type="button"
                          aria-pressed={on}
                          title={`${c.type.durationMinutes} min`}
                          onClick={() => toggleType(c.type.id)}
                          className={cn(
                            'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            on ? 'border-primary bg-primary text-primary-foreground shadow-glow' : 'border-border bg-background/70 text-foreground/80 hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          {on ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                  {chosen.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-primary/[0.06] px-4 py-3" aria-live="polite">
                      <span className="text-sm font-semibold">You chose</span>
                      <ul className="flex flex-1 flex-wrap gap-1.5" aria-label="Chosen services">
                        {chosen.map((t) => (
                          <li key={t.id} className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/30 bg-background pl-3 pr-1 text-sm font-medium">
                            {categoryOf(t.id) ?? t.name} <span className="text-xs font-normal text-muted-foreground">· {t.durationMinutes} min</span>
                            <button
                              type="button"
                              aria-label={`Remove ${categoryOf(t.id) ?? t.name}`}
                              onClick={() => toggleType(t.id)}
                              className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <span className="text-sm text-muted-foreground">{totalMinutes} min</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No services can be booked online right now. Please call the clinic.</p>
              )}
            </section>
          )}
          {location && d.branches.length > 1 && !branch && <p className="rounded-2xl surface-flat p-4 text-sm text-muted-foreground">Choose a branch to see its vets.</p>}
          {location && vets.length > 0 && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">{vets.length > 1 ? `Any vet you prefer at ${branch?.name}?` : `Your vet at ${branch?.name}`}</h3>
              <div className="flex flex-wrap gap-2">
                {[...(vets.length > 1 ? [{ id: '', name: 'Any vet', jobTitle: 'First free time' }] : []), ...vets].map((v) => (
                  <button
                    key={v.id || 'any'}
                    type="button"
                    onClick={() => {
                      setVetId(v.id);
                      setTime(null);
                    }}
                    className={cn(
                      'min-h-12 rounded-2xl px-4 py-2 text-left transition-all duration-200 ease-apple',
                      vetId === v.id ? 'bg-primary text-primary-foreground shadow-glow' : 'surface-flat hover:-translate-y-0.5',
                    )}
                  >
                    <span className="block text-sm font-semibold">{v.name}</span>
                    {v.jobTitle && <span className={cn('block text-xs', vetId === v.id ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{v.jobTitle}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" className="sm:mr-auto" onClick={() => setStep('pet')}>
              <ArrowLeft /> Back
            </Button>
            {(!location || !type || !branch) && (
              <p className="text-sm text-muted-foreground">{!location ? 'Choose a visit at the clinic or at home.' : !branch ? 'Choose the clinic first.' : 'Choose what the visit is for.'}</p>
            )}
            <Button size="lg" className="w-full sm:w-auto" disabled={!location || !type || !branch} onClick={() => setStep('time')}>
              Choose a time <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {step === 'time' && branch && type && (
        <div className="surface grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl p-5 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">When would you like to come?</h3>
            <span className="text-sm text-muted-foreground">
              {visitName} · {totalMinutes} min
              {home ? ' · Home visit' : ''}
              {vet ? ` · ${vet.name}` : ''}
            </span>
          </div>
          {error && <FormError message={error} />}
          <SlotPicker
            slug={slug}
            branchId={branch.id}
            appointmentTypeId={type.id}
            extraTypeIds={extraTypeIds}
            location={location ?? 'CLINIC'}
            clinicianId={vetId || undefined}
            timezone={tz}
            value={time}
            onChange={(t) => {
              setTime(t);
              setError(null);
            }}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setStep('service')}>
              <ArrowLeft /> Back
            </Button>
            <Button
              size="lg"
              disabled={!time}
              onClick={() => {
                setError(null);
                setStep('details');
              }}
            >
              {time ? `Continue · ${branchTime(time.startsAt, tz, 'EEE d MMM, h:mm a')}` : 'Choose a time'} <ArrowRight />
            </Button>
          </div>
        </div>
      )}

      {step === 'details' && branch && type && time && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form
            className="surface grid gap-5 rounded-2xl p-5 sm:p-8"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
              setError(null);
              if (parsed.success) book.mutate();
              // Something from an earlier step is missing (e.g. the pet's name): say what.
              else if (!errs.visitAddress && !errs.visitMapUrl && !errs.email) setError(Object.values(errs).find(Boolean) ?? 'Please check your details.');
            }}
          >
            <div>
              <h3 className="text-lg font-semibold">Almost done</h3>
              <p className="text-sm text-muted-foreground">Check your visit, add anything we should know, and confirm.</p>
            </div>
            {error && <FormError message={error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              {home && (
                <fieldset className="grid gap-4 rounded-2xl bg-primary/[0.04] p-4 ring-1 ring-inset ring-primary/15 sm:col-span-2">
                  <legend className="sr-only">Where should the vet come?</legend>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <MapPin className="h-4 w-4 text-primary" /> Where should the vet come?
                  </p>
                  <Field label="Address" htmlFor="b-address" required error={tried ? errs.visitAddress : undefined}>
                    <Textarea
                      id="b-address"
                      rows={2}
                      maxLength={500}
                      autoComplete="street-address"
                      placeholder="House, street, area, city"
                      value={f.visitAddress}
                      onChange={(e) => setF({ ...f, visitAddress: e.target.value })}
                      aria-invalid={tried && !!errs.visitAddress}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="How to find it (optional)" htmlFor="b-directions" hint="Landmark, gate, floor, parking">
                      <Input id="b-directions" maxLength={500} placeholder="e.g. Green gate opposite the mosque" value={f.visitDirections} onChange={(e) => setF({ ...f, visitDirections: e.target.value })} />
                    </Field>
                    <Field label="Map link (optional)" htmlFor="b-map" hint="Share your location from Google Maps" error={tried ? errs.visitMapUrl : undefined}>
                      <Input
                        id="b-map"
                        type="url"
                        inputMode="url"
                        placeholder="https://maps.app.goo.gl/…"
                        value={f.visitMapUrl}
                        onChange={(e) => setF({ ...f, visitMapUrl: e.target.value })}
                        aria-invalid={tried && !!errs.visitMapUrl}
                      />
                    </Field>
                  </div>
                </fieldset>
              )}
              <Field label="Email (optional)" htmlFor="b-email" error={tried ? errs.email : undefined} className="sm:col-span-2">
                <Input id="b-email" type="email" autoComplete="email" placeholder="name@gmail.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-invalid={tried && !!errs.email} />
              </Field>
              <Field label="Anything we should know? (optional)" htmlFor="b-reason" className="sm:col-span-2">
                <Textarea id="b-reason" rows={3} maxLength={500} placeholder="e.g. Not eating since yesterday, first vaccination…" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </Field>
              {/* Robots fill this in; people never see it. */}
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label htmlFor="b-website">Website</label>
                <input id="b-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep('time')}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" size="lg" loading={book.isPending}>
                <CalendarCheck /> Confirm booking
              </Button>
            </div>
          </form>
          <aside className="surface h-fit rounded-2xl p-5 lg:sticky lg:top-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your visit</p>
            <Summary rows={summaryRows} />
            <button type="button" onClick={() => setStep('service')} className="mt-4 flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              <Pencil className="h-3.5 w-3.5" /> Change
            </button>
          </aside>
        </div>
      )}

      {step === 'done' && done && (
        <div className="surface-strong mx-auto grid max-w-xl gap-6 rounded-2xl p-6 text-center sm:p-10">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-success/15 text-success ring-8 ring-success/[0.07]">
            <CheckCircle2 className="h-10 w-10" />
          </span>
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{done.status === 'CONFIRMED' ? 'You’re booked!' : 'Booking received!'}</h2>
            <p className="mt-2 text-muted-foreground">
              {done.status === 'CONFIRMED' ? 'Your appointment is confirmed.' : 'The clinic will confirm it shortly.'} A confirmation is on its way to your WhatsApp
              {f.email ? ' or email' : ''}.
            </p>
          </div>
          <div className="rounded-2xl surface-flat p-5 text-left">
            <Summary
              rows={[
                {
                  icon: Clock,
                  label: 'When',
                  value: `${branchTime(done.startsAt, done.branch.timezone, 'EEEE d MMMM')} at ${branchTime(done.startsAt, done.branch.timezone, 'h:mm a')}`,
                },
                {
                  icon: Stethoscope,
                  label: done.extraTypeIds?.length ? 'Services' : 'Service',
                  value: done.service,
                },
                { icon: PawPrint, label: 'For', value: done.petName ?? '—' },
                {
                  icon: User,
                  label: 'Vet',
                  value: done.vet ?? 'The first free vet',
                },
                done.location === 'HOME'
                  ? {
                      icon: Home,
                      label: 'Where',
                      value: `Home visit · ${done.visitAddress ?? ''}`,
                    }
                  : {
                      icon: CalendarCheck,
                      label: 'Where',
                      value: [done.branch.name, done.branch.address].filter(Boolean).join(' · '),
                    },
              ]}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" size="lg" onClick={() => downloadIcs(done, d.clinic.name)}>
              <CalendarPlus /> Add to my calendar
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href={new URL(done.manageLink).pathname}>
                <Pencil /> Change or cancel
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Keep the link in your confirmation message — it lets you change or cancel up to {d.settings.cancelNoticeHours} hours before.</p>
        </div>
      )}
    </BookingFrame>
  );
}

export default function PublicBookingPage() {
  return <BookingPage />;
}
