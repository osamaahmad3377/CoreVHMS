'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingIcs, formatMoney, publicBookingSchema } from '@vcms/shared';
import { ArrowLeft, ArrowRight, CalendarCheck, CalendarPlus, CheckCircle2, Clock, PawPrint, Pencil, Stethoscope, User } from 'lucide-react';
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

type Step = 'service' | 'time' | 'details' | 'done';
const STEPS: { key: Exclude<Step, 'done'>; label: string }[] = [
  { key: 'service', label: 'Service' },
  { key: 'time', label: 'Day & time' },
  { key: 'details', label: 'Your details' },
];

/** Saves the .ics so the visit lands in the client's own phone calendar. */
function downloadIcs(b: BookingSummary, clinic: string) {
  const ics = bookingIcs({ uid: `${b.id}@nextcore`, startsAt: b.startsAt, endsAt: b.endsAt, title: `${b.service}${b.petName ? ` — ${b.petName}` : ''} at ${clinic}`, location: [b.branch.name, b.branch.address].filter(Boolean).join(', '), description: b.vet ? `With ${b.vet}` : null });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'appointment.ics' });
  a.click();
  URL.revokeObjectURL(url);
}

function Progress({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Booking steps">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex flex-1 items-center gap-2">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors', i < at ? 'bg-success text-white' : i === at ? 'bg-primary text-primary-foreground shadow-glow' : 'bg-foreground/[0.07] text-muted-foreground')} aria-current={i === at ? 'step' : undefined}>
            {i < at ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </span>
          <span className={cn('hidden text-sm font-medium sm:block', i === at ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          {i < STEPS.length - 1 && <span className={cn('h-0.5 flex-1 rounded-full', i < at ? 'bg-success/60' : 'bg-foreground/10')} />}
        </li>
      ))}
    </ol>
  );
}

/** The chosen visit, shown beside the details form and on the confirmation. */
function Summary({ rows }: { rows: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }[] }) {
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
  const info = useQuery({ queryKey: ['public-booking', slug], queryFn: () => api.get<BookingInfo>(`/public/booking/${slug}`), retry: false });
  const [step, setStep] = useState<Step>('service');
  const [branchId, setBranchId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [vetId, setVetId] = useState('');
  const [time, setTime] = useState<FreeTime | null>(null);
  const [f, setF] = useState({ ownerName: '', mobilePhone: '', email: '', petName: '', speciesId: '', reason: '', website: '' });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(BookingSummary & { manageLink: string }) | null>(null);

  const d = info.data;
  const branch = d?.branches.find((b) => b.id === branchId) ?? (d?.branches.length === 1 ? d.branches[0] : undefined);
  const type = d?.appointmentTypes.find((t) => t.id === typeId);
  const vets = useMemo(() => (d?.clinicians ?? []).filter((c) => !branch || c.branchIds.includes(branch.id)), [d, branch]);
  const vet = vets.find((v) => v.id === vetId);
  const tz = branch?.timezone ?? 'UTC';

  const parsed = publicBookingSchema.safeParse({ ...f, branchId: branch?.id, appointmentTypeId: typeId, clinicianId: vetId, startsAt: time?.startsAt });
  const errs: Record<string, string | undefined> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;

  const book = useMutation({
    mutationFn: () => api.post<BookingSummary & { manageLink: string }>(`/public/booking/${slug}`, { ...f, branchId: branch!.id, appointmentTypeId: typeId, clinicianId: vetId, startsAt: time!.startsAt }),
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
  const when = time ? `${branchTime(time.startsAt, tz, 'EEEE d MMMM')} at ${branchTime(time.startsAt, tz, 'h:mm a')}` : '';
  const summaryRows = [
    type && { icon: Stethoscope, label: 'Service', value: `${type.name} · ${type.durationMinutes} min` },
    time && { icon: Clock, label: 'When', value: when },
    { icon: User, label: 'Vet', value: vet?.name ?? (time && time.clinicianIds.length ? 'First free vet' : 'Any vet') },
    branch && d.branches.length > 1 && { icon: CalendarCheck, label: 'Where', value: branch.name },
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; label: string; value: string }[];

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

      {step === 'service' && (
        <div className="surface grid grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl p-5 sm:p-8">
          {d.branches.length > 1 && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">Which clinic?</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {d.branches.map((b) => (
                  <button key={b.id} type="button" onClick={() => { setBranchId(b.id); setVetId(''); setTime(null); }} className={cn('rounded-2xl p-4 text-left transition-all duration-200 ease-apple', branch?.id === b.id ? 'bg-primary/10 ring-2 ring-primary' : 'surface-flat hover:-translate-y-0.5')}>
                    <span className="block font-semibold">{b.name}</span>
                    {b.address && <span className="block text-sm text-muted-foreground">{b.address}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">What is the visit for?</h3>
            {d.appointmentTypes.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {d.appointmentTypes.map((t) => (
                  <button key={t.id} type="button" onClick={() => { setTypeId(t.id); setTime(null); }} className={cn('flex items-center gap-3 rounded-2xl p-4 text-left transition-all duration-200 ease-apple', typeId === t.id ? 'bg-primary/10 ring-2 ring-primary' : 'surface-flat hover:-translate-y-0.5')}>
                    <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {t.durationMinutes} min{t.priceMinor ? ` · from ${formatMoney(t.priceMinor, d.clinic.currency)}` : ''}
                      </span>
                    </span>
                    {typeId === t.id && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No services can be booked online right now. Please call the clinic.</p>
            )}
          </section>
          {vets.length > 1 && (
            <section className="grid gap-3">
              <h3 className="text-lg font-semibold">Any vet you prefer?</h3>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', name: 'Any vet', jobTitle: 'First free time' }, ...vets].map((v) => (
                  <button key={v.id || 'any'} type="button" onClick={() => { setVetId(v.id); setTime(null); }} className={cn('min-h-12 rounded-2xl px-4 py-2 text-left transition-all duration-200 ease-apple', vetId === v.id ? 'bg-primary text-primary-foreground shadow-glow' : 'surface-flat hover:-translate-y-0.5')}>
                    <span className="block text-sm font-semibold">{v.name}</span>
                    {v.jobTitle && <span className={cn('block text-xs', vetId === v.id ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{v.jobTitle}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
            {(!type || !branch) && <p className="text-sm text-muted-foreground sm:mr-auto">{!branch ? 'Choose the clinic first.' : 'Choose what the visit is for.'}</p>}
            <Button size="lg" className="w-full sm:w-auto" disabled={!type || !branch} onClick={() => setStep('time')}>
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
              {type.name}
              {vet ? ` · ${vet.name}` : ''}
            </span>
          </div>
          {error && <FormError message={error} />}
          <SlotPicker slug={slug} branchId={branch.id} appointmentTypeId={type.id} clinicianId={vetId || undefined} timezone={tz} value={time} onChange={(t) => { setTime(t); setError(null); }} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setStep('service')}>
              <ArrowLeft /> Back
            </Button>
            <Button size="lg" disabled={!time} onClick={() => { setError(null); setStep('details'); }}>
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
            }}
          >
            <h3 className="text-lg font-semibold">Your details</h3>
            {error && <FormError message={error} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" htmlFor="b-name" required error={tried ? errs.ownerName : undefined}>
                <Input id="b-name" autoComplete="name" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} aria-invalid={tried && !!errs.ownerName} />
              </Field>
              <Field label="Mobile (WhatsApp)" htmlFor="b-phone" required hint="We send your confirmation here." error={tried ? errs.mobilePhone : undefined}>
                <Input id="b-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" value={f.mobilePhone} onChange={(e) => setF({ ...f, mobilePhone: e.target.value })} aria-invalid={tried && !!errs.mobilePhone} />
              </Field>
              <Field label="Pet’s name" htmlFor="b-pet" required error={tried ? errs.petName : undefined}>
                <Input id="b-pet" value={f.petName} onChange={(e) => setF({ ...f, petName: e.target.value })} aria-invalid={tried && !!errs.petName} />
              </Field>
              <Field label="Kind of animal" htmlFor="b-species" required error={tried ? errs.speciesId : undefined}>
                <NativeSelect id="b-species" value={f.speciesId} onChange={(e) => setF({ ...f, speciesId: e.target.value })} aria-invalid={tried && !!errs.speciesId}>
                  <option value="">Choose…</option>
                  {d.species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
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
            {!d.settings.allowNewClients && <p className="text-xs text-muted-foreground">Online booking is for clients already registered with the clinic — use the mobile number they have for you.</p>}
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
              {done.status === 'CONFIRMED' ? 'Your appointment is confirmed.' : 'The clinic will confirm it shortly.'} A confirmation is on its way to your WhatsApp{f.email ? ' or email' : ''}.
            </p>
          </div>
          <div className="rounded-2xl surface-flat p-5 text-left">
            <Summary
              rows={[
                { icon: Clock, label: 'When', value: `${branchTime(done.startsAt, done.branch.timezone, 'EEEE d MMMM')} at ${branchTime(done.startsAt, done.branch.timezone, 'h:mm a')}` },
                { icon: Stethoscope, label: 'Service', value: done.service },
                { icon: PawPrint, label: 'For', value: done.petName ?? '—' },
                { icon: User, label: 'Vet', value: done.vet ?? 'The first free vet' },
                { icon: CalendarCheck, label: 'Where', value: [done.branch.name, done.branch.address].filter(Boolean).join(' · ') },
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

