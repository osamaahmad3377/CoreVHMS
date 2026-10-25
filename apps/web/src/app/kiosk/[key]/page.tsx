'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { brandThemeCss, type Branding } from '@vcms/shared';
import { ArrowLeft, CheckCircle2, Delete, LogIn, PawPrint, Phone, Printer, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { printTokenSlip } from '@/components/scheduling/token-slip';

interface KioskInfo {
  clinic: { name: string; phone: string | null; branding: Branding };
  branch: { name: string; timezone: string; address: string | null };
  walkIns: { id: string; name: string }[];
}
type Lookup = { found: false } | { found: true; firstName: string; visits: { id: string; startsAt: string; petName: string | null; service: string; checkedIn: boolean; token: number | null }[]; pets: { id: string; name: string }[] };
type Done = { token: number | null; petName: string | null; startsAt: string; ahead: number; checkedInAt: string | null; service?: string | null; booked?: boolean };
type Step = 'home' | 'phone' | 'choose' | 'reason' | 'done' | 'unknown';

const IDLE_MS = 45_000;
const DONE_MS = 20_000;
/** Tokens read like a ticket: 7 → 007. */
const tk = (n: number | null | undefined) => (n == null ? '—' : String(n).padStart(3, '0'));
/** 03313213213 → 0331 321 3213 as it is typed. */
const grouped = (p: string) => (p.startsWith('+') ? p.replace(/^(\+\d{2})(\d{0,3})(\d{0,3})(\d*)$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' ')) : p.replace(/^(\d{0,4})(\d{0,3})(\d*)$/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' ')));

/** Live time for the welcome screen. */
function Now({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-right leading-tight">
      <span className="block text-3xl font-bold tabular">{branchTime(now, tz, 'h:mm a')}</span>
      <span className="block text-lg text-muted-foreground">{branchTime(now, tz, 'EEEE d MMMM')}</span>
    </span>
  );
}

/** Seconds left before the tablet goes back to the start, as a shrinking bar. */
function Countdown({ ms, onEnd }: { ms: number; onEnd: () => void }) {
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      const l = Math.max(0, ms - (Date.now() - started));
      setLeft(l);
      if (!l) onEnd();
    }, 250);
    return () => clearInterval(t);
  }, [ms, onEnd]);
  return (
    <div className="grid gap-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${(left / ms) * 100}%` }} />
      </div>
      <p className="text-center text-base text-muted-foreground">Back to the start in {Math.ceil(left / 1000)} s</p>
    </div>
  );
}

/** A big touch button for the tablet. */
function Big({ children, onClick, tone = 'default', disabled, className }: { children: React.ReactNode; onClick: () => void; tone?: 'default' | 'primary' | 'ghost'; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-[72px] items-center justify-center gap-3 rounded-3xl px-8 text-2xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:opacity-40',
        tone === 'primary' ? 'bg-primary bg-gradient-to-b from-white/15 to-transparent text-primary-foreground shadow-glow' : tone === 'ghost' ? 'text-muted-foreground hover:bg-foreground/5' : 'bg-card text-foreground shadow-card ring-1 ring-inset ring-foreground/10 hover:ring-primary/40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The check-in tablet at the door: the client types their mobile number, taps their appointment (or their
 * animal, if they have none) and gets a token number to watch for on the waiting-room screen. Resets itself.
 */
function Kiosk() {
  const { key } = useParams<{ key: string }>();
  const info = useQuery({ queryKey: ['kiosk', key], queryFn: () => api.get<KioskInfo>(`/public/waiting-room/kiosk/${key}`), retry: 1, refetchInterval: 300_000 });
  const [step, setStep] = useState<Step>('home');
  const [phone, setPhone] = useState('');
  const [who, setWho] = useState<Extract<Lookup, { found: true }> | null>(null);
  const [pet, setPet] = useState<{ id: string; name: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setStep('home');
    setPhone('');
    setWho(null);
    setPet(null);
    setDone(null);
    setError(null);
  }, []);
  // Goes back to the start when left alone, so the next client never sees someone else's details.
  useEffect(() => {
    if (step === 'home') return;
    if (timer.current) clearTimeout(timer.current);
    if (step !== 'done') timer.current = setTimeout(reset, IDLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [step, phone, reset]);

  const fail = (e: Error) => setError(e.message);
  const lookup = useMutation({
    mutationFn: () => api.post<Lookup>(`/public/waiting-room/kiosk/${key}/lookup`, { mobilePhone: phone }),
    onSuccess: (r) => {
      setError(null);
      if (!r.found) return setStep('unknown');
      setWho(r);
      setStep('choose');
    },
    onError: fail,
  });
  const checkIn = useMutation({
    mutationFn: (appointmentId: string) => api.post<Done>(`/public/waiting-room/kiosk/${key}/check-in`, { mobilePhone: phone, appointmentId }),
    onSuccess: (r, appointmentId) => {
      setDone({ ...r, service: who?.visits.find((v) => v.id === appointmentId)?.service ?? null, booked: true });
      setStep('done');
    },
    onError: fail,
  });
  const walkIn = useMutation({
    mutationFn: (appointmentTypeId: string) => api.post<Done>(`/public/waiting-room/kiosk/${key}/walk-in`, { mobilePhone: phone, patientId: pet!.id, appointmentTypeId }),
    onSuccess: (r, appointmentTypeId) => {
      setDone({ ...r, service: info.data?.walkIns.find((t) => t.id === appointmentTypeId)?.name ?? null, booked: false });
      setStep('done');
    },
    onError: fail,
  });

  if (info.isLoading) return <div className="app-canvas min-h-screen" />;
  if (!info.data)
    return (
      <div className="app-canvas grid min-h-screen place-items-center p-10 text-center">
        <div className="surface-strong max-w-lg rounded-3xl p-10">
          <p className="text-3xl font-semibold">Check-in is not available</p>
          <p className="mt-3 text-xl text-muted-foreground">Please see the front desk.</p>
        </div>
      </div>
    );
  const d = info.data;
  const tz = d.branch.timezone;
  const css = brandThemeCss(d.clinic.branding);
  const busy = lookup.isPending || checkIn.isPending || walkIn.isPending;
  const digits = phone.replace(/\D/g, '');

  return (
    <div className="app-canvas flex min-h-screen select-none flex-col">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <header className="flex items-center gap-4 px-8 pb-4 pt-8">
        {d.clinic.branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.clinic.branding.logoUrl} alt="" className="h-16 max-w-[200px] object-contain" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-3xl font-bold text-white">{d.clinic.name.charAt(0)}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-balance text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{d.clinic.name}</p>
          <p className="text-lg text-muted-foreground">{d.branch.name}</p>
        </div>
        <Now tz={tz} />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-8 pb-10">
        {error && <p className="rounded-2xl bg-destructive/10 p-5 text-center text-xl font-medium text-destructive ring-1 ring-inset ring-destructive/25">{error}</p>}

        {step === 'home' && (
          <div className="surface-strong grid gap-8 rounded-[2rem] p-10 text-center">
            <span className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PawPrint className="h-12 w-12" />
            </span>
            <div>
              <h1 className="text-5xl font-bold tracking-tight">Welcome!</h1>
              <p className="mt-3 text-2xl text-muted-foreground">Check in here and we’ll call you on the screen.</p>
            </div>
            <Big tone="primary" onClick={() => setStep('phone')} className="min-h-[88px] text-3xl">
              <LogIn className="h-8 w-8" /> Check in
            </Big>
          </div>
        )}

        {step === 'phone' && (
          <div className="surface-strong grid gap-6 rounded-[2rem] p-8">
            <h2 className="text-center text-3xl font-bold">Your mobile number</h2>
            <p className="flex min-h-[80px] items-center justify-center rounded-2xl bg-foreground/[0.05] px-6 text-center text-5xl font-semibold tabular tracking-wider" aria-live="polite">
              {phone ? grouped(phone) : <span className="text-3xl font-normal text-muted-foreground">e.g. 0300 1234567</span>}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0'].map((k) => (
                <Big key={k} onClick={() => phone.length < 16 && setPhone(phone + k)} className="min-h-[84px] text-4xl">
                  {k}
                </Big>
              ))}
              <Big onClick={() => setPhone(phone.slice(0, -1))} className="min-h-[84px]" disabled={!phone}>
                <Delete className="h-8 w-8" />
              </Big>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <Big tone="ghost" onClick={reset}>
                <ArrowLeft className="h-6 w-6" /> Back
              </Big>
              <Big tone="primary" disabled={digits.length < 7 || busy} onClick={() => lookup.mutate()}>
                {busy ? 'Looking…' : 'Next'}
              </Big>
            </div>
          </div>
        )}

        {step === 'choose' && who && (
          <div className="surface-strong grid gap-6 rounded-[2rem] p-8">
            <h2 className="text-center text-4xl font-bold">Hello {who.firstName}!</h2>
            {who.visits.length > 0 && (
              <div className="grid gap-3">
                <p className="text-center text-2xl text-muted-foreground">Tap your appointment</p>
                {who.visits.map((v) => (
                  <Big key={v.id} onClick={() => checkIn.mutate(v.id)} disabled={busy} className="justify-between text-left">
                    <span className="min-w-0">
                      <span className="block truncate">{v.petName ?? 'Your appointment'}</span>
                      <span className="block text-lg font-normal text-muted-foreground">
                        {branchTime(v.startsAt, tz, 'h:mm a')} · {v.service}
                      </span>
                    </span>
                    {v.checkedIn ? <span className="text-xl text-success">Checked in · #{v.token}</span> : <CheckCircle2 className="h-8 w-8 shrink-0 text-primary" />}
                  </Big>
                ))}
              </div>
            )}
            {who.pets.length > 0 && (
              <div className="grid gap-3">
                <p className="text-center text-2xl text-muted-foreground">{who.visits.length ? 'Or, without an appointment, who is the visit for?' : 'No appointment today? Who is the visit for?'}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {who.pets.map((p) => (
                    <Big
                      key={p.id}
                      disabled={busy}
                      onClick={() => {
                        setPet(p);
                        if (d.walkIns.length === 1) walkIn.mutate(d.walkIns[0].id);
                        else setStep('reason');
                      }}
                    >
                      <PawPrint className="h-6 w-6 text-primary" /> {p.name}
                    </Big>
                  ))}
                </div>
              </div>
            )}
            {!who.visits.length && !who.pets.length && <p className="text-center text-2xl text-muted-foreground">We found you, but there is nothing to check in today. Please see the front desk.</p>}
            <Big tone="ghost" onClick={reset}>
              <ArrowLeft className="h-6 w-6" /> Start again
            </Big>
          </div>
        )}

        {step === 'reason' && pet && (
          <div className="surface-strong grid gap-6 rounded-[2rem] p-8">
            <h2 className="text-center text-3xl font-bold">What is the visit for?</h2>
            <p className="-mt-3 text-center text-xl text-muted-foreground">{pet.name}</p>
            <div className="grid gap-3">
              {d.walkIns.map((t) => (
                <Big key={t.id} disabled={busy} onClick={() => walkIn.mutate(t.id)}>
                  {t.name}
                </Big>
              ))}
            </div>
            <Big tone="ghost" onClick={() => setStep('choose')}>
              <ArrowLeft className="h-6 w-6" /> Back
            </Big>
          </div>
        )}

        {step === 'done' && done && (
          <div className="surface-strong grid gap-7 rounded-[2rem] p-10 text-center">
            <div className="flex items-center justify-center gap-3 text-2xl font-semibold text-success">
              <CheckCircle2 className="h-9 w-9" /> You’re checked in{done.petName ? ` with ${done.petName}` : ''}
            </div>
            <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-primary to-brand-2 px-8 py-8 text-white shadow-glow">
              <p className="text-xl font-semibold uppercase tracking-[0.35em] text-white/80">Your token</p>
              <p className="text-[8.5rem] font-black leading-none tabular tracking-tighter">{tk(done.token)}</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-xl text-white/85">
                <Users className="h-5 w-5" /> {done.ahead === 0 ? 'You are next' : `${done.ahead} ${done.ahead === 1 ? 'person' : 'people'} ahead of you`}
              </p>
            </div>
            <p className="text-2xl text-muted-foreground">Please take a seat and watch the screen. We’ll call your number.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Big
                onClick={() =>
                  done.token != null &&
                  void printTokenSlip({
                    clinic: d.clinic.name,
                    branch: d.branch.name,
                    token: done.token,
                    petName: done.petName,
                    service: done.service,
                    ahead: done.ahead,
                    issuedAt: branchTime(done.checkedInAt ?? new Date().toISOString(), tz, 'd MMM yyyy, h:mm a'),
                    bookedAt: done.booked ? branchTime(done.startsAt, tz, 'h:mm a') : null,
                    phone: d.clinic.phone,
                  })
                }
              >
                <Printer className="h-7 w-7" /> Print my token
              </Big>
              <Big tone="primary" onClick={reset}>
                Done
              </Big>
            </div>
            <Countdown ms={DONE_MS} onEnd={reset} />
          </div>
        )}

        {step === 'unknown' && (
          <div className="surface-strong grid gap-6 rounded-[2rem] p-10 text-center">
            <Phone className="mx-auto h-16 w-16 text-muted-foreground" />
            <p className="text-3xl font-semibold">We couldn’t find this number</p>
            <p className="text-2xl text-muted-foreground">Please see the front desk — they’ll check you in{d.clinic.phone ? `, or call ${d.clinic.phone}` : ''}.</p>
            <div className="grid grid-cols-2 gap-3">
              <Big tone="ghost" onClick={() => setStep('phone')}>
                <ArrowLeft className="h-6 w-6" /> Try again
              </Big>
              <Big tone="primary" onClick={reset}>
                OK
              </Big>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}

export default function KioskPage() {
  return <Kiosk />;
}
