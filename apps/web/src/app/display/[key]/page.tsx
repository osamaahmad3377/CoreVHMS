'use client';
import { useQuery } from '@tanstack/react-query';
import { brandThemeCss, callAnnouncement, type Branding } from '@vcms/shared';
import { DoorOpen, Maximize, Users, Volume2, WifiOff } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { branchTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Screen {
  clinic: { name: string; branding: Branding };
  branch: { name: string; timezone: string };
  message: string | null;
  announce: boolean;
  now: string;
  calls: { id: string; token: number; room: string | null; pet: string | null; calledAt: string; callCount: number }[];
  waiting: { token: number; pet: string | null }[];
  rooms: { name: string; token: number | null; pet: string | null }[];
  seenToday: number;
}

/** Tokens read like a ticket: 7 → 007. */
const tk = (n: number | null | undefined) => (n == null ? '—' : String(n).padStart(3, '0'));

/** A soft two-note chime (no sound file needed). */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [
      [880, 0],
      [660, 0.3],
    ].forEach(([f, at]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 1);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 1.1);
    });
    setTimeout(() => void ctx.close(), 2500);
  } catch {
    /* no audio */
  }
}

function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.88;
    window.speechSynthesis.speak(u);
  } catch {
    /* no speech */
  }
}

function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right leading-none">
      <p className="text-[3.5rem] font-bold tabular tracking-tight">
        {branchTime(now, tz, 'h:mm')}
        <span className="ml-2 text-2xl font-semibold text-white/60">{branchTime(now, tz, 'a')}</span>
      </p>
      <p className="mt-2 text-xl text-white/60">{branchTime(now, tz, 'EEEE, d MMMM')}</p>
    </div>
  );
}

/** Scrolling line along the bottom of the screen. */
function Ticker({ items }: { items: string[] }) {
  const text = items.join('     •     ');
  return (
    <div className="relative overflow-hidden whitespace-nowrap border-t border-white/10 bg-black/30 py-4 text-2xl font-medium text-white/85">
      <style>{'@keyframes vcms-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
      <div className="inline-flex" style={{ animation: `vcms-ticker ${Math.max(30, text.length / 3)}s linear infinite` }}>
        <span className="px-12">{text}</span>
        <span className="px-12" aria-hidden>
          {text}
        </span>
      </div>
    </div>
  );
}

/**
 * The waiting-room TV, laid out like a professional queue board: the token now being served, every consult
 * room with its current token, who is next in line, and a scrolling notice. A new call takes over the whole screen
 * for a few seconds with a chime and a spoken announcement. Refreshes every 3 seconds.
 */
function Display() {
  const { key } = useParams<{ key: string }>();
  const q = useQuery({ queryKey: ['display', key], queryFn: () => api.get<Screen>(`/public/waiting-room/display/${key}`), refetchInterval: 3000, retry: 1 });
  const [started, setStarted] = useState(false);
  const [announcing, setAnnouncing] = useState<Screen['calls'][number] | null>(null);
  const seen = useRef<string | null>(null);
  const d = q.data;
  const latest = d?.calls[0];

  useEffect(() => {
    if (!latest) return;
    const sig = `${latest.id}:${latest.callCount}`;
    if (seen.current === null) {
      seen.current = sig; // calls already on screen when it opened are not announced again
      return;
    }
    if (sig === seen.current) return;
    seen.current = sig;
    setAnnouncing(latest);
    const t = setTimeout(() => setAnnouncing(null), 8000);
    if (started) {
      chime();
      if (d?.announce) setTimeout(() => speak(callAnnouncement(latest.token, latest.room)), 1000);
    }
    return () => clearTimeout(t);
  }, [latest, started, d?.announce]);

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (started && nav.wakeLock) nav.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [started]);

  const bg = 'bg-[hsl(232_45%_7%)]';
  if (q.isLoading) return <div className={cn('min-h-screen', bg)} />;
  if (!d)
    return (
      <div className={cn('grid min-h-screen place-items-center p-10 text-center text-white', bg)}>
        <div>
          <p className="text-4xl font-semibold">This screen is not available</p>
          <p className="mt-3 text-xl text-white/60">The link may have changed, or the screen is switched off in Settings → Waiting room.</p>
        </div>
      </div>
    );

  const css = brandThemeCss(d.clinic.branding);
  const logo = d.clinic.branding.logoUrl;
  const next = d.waiting.slice(0, 8);
  const ticker = [d.message, 'Please keep your token number until you are called', 'Emergencies are seen first — thank you for your patience', `${d.clinic.name} · ${d.branch.name}`].filter(Boolean) as string[];

  return (
    <div className={cn('relative flex h-screen min-h-[720px] flex-col overflow-hidden text-white', bg)} style={{ backgroundImage: 'radial-gradient(1100px 700px at 0% -20%, hsl(var(--primary) / 0.5), transparent 60%), radial-gradient(900px 700px at 110% 120%, hsl(var(--brand-2) / 0.35), transparent 60%)' }}>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}

      <header className="flex items-center gap-6 border-b border-white/10 px-12 py-7">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-[4.5rem] max-w-[220px] rounded-2xl bg-white p-2 object-contain shadow-lg" />
        ) : (
          <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-brand-2 text-4xl font-bold">{d.clinic.name.charAt(0)}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[2.75rem] font-bold leading-tight tracking-tight">{d.clinic.name}</h1>
          <p className="text-xl text-white/60">{d.branch.name} · Waiting room</p>
        </div>
        <Clock tz={d.branch.timezone} />
      </header>

      <main className="grid min-h-0 flex-1 gap-8 px-12 py-8 [grid-template-columns:minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-8">
          {/* Now serving */}
          <div className="relative flex flex-1 items-center overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-br from-white/[0.12] to-white/[0.04] px-14 shadow-2xl">
            <span aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
            <div className="relative grid w-full gap-4">
              <p className="text-2xl font-semibold uppercase tracking-[0.35em] text-white/60">{latest ? 'Now serving' : 'Welcome'}</p>
              {latest ? (
                <div className="flex flex-wrap items-end gap-x-14 gap-y-4">
                  <p className="text-[clamp(8rem,13vw,13rem)] font-black leading-[0.85] tabular tracking-tighter">{tk(latest.token)}</p>
                  <div className="pb-4">
                    <p className="text-2xl uppercase tracking-[0.2em] text-white/55">{latest.room ? 'Please go to' : 'Please come in'}</p>
                    {latest.room && <p className="mt-1 text-[clamp(2.75rem,4.5vw,4.5rem)] font-bold leading-tight">{latest.room}</p>}
                    {latest.pet && <p className="mt-2 text-3xl text-white/70">{latest.pet}</p>}
                  </div>
                </div>
              ) : (
                <p className="max-w-3xl text-5xl font-semibold leading-tight">Please take a seat. Your token number will appear here when it is your turn.</p>
              )}
            </div>
          </div>

          {/* Rooms */}
          {d.rooms.length > 0 && (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(d.rooms.length, 4)}, minmax(0, 1fr))` }}>
              {d.rooms.slice(0, 4).map((r) => (
                <div key={r.name} className={cn('rounded-3xl border px-6 py-5', r.token ? 'border-white/15 bg-white/[0.08]' : 'border-white/5 bg-white/[0.03]')}>
                  <p className="flex items-center gap-2 truncate text-xl font-medium text-white/60">
                    <DoorOpen className="h-5 w-5 shrink-0" /> {r.name}
                  </p>
                  <p className={cn('mt-1 text-6xl font-bold tabular', !r.token && 'text-3xl font-semibold text-white/35')}>{r.token ? tk(r.token) : 'Free'}</p>
                  {r.pet && <p className="truncate text-xl text-white/60">{r.pet}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Next in line */}
        <section className="flex min-h-0 flex-col rounded-[2.5rem] border border-white/10 bg-white/[0.05] p-9">
          <div className="mb-6 flex items-center justify-between">
            <p className="text-2xl font-semibold uppercase tracking-[0.25em] text-white/60">Next in line</p>
            <span className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xl font-semibold tabular">
              <Users className="h-5 w-5" /> {d.waiting.length}
            </span>
          </div>
          {next.length ? (
            <ol className="grid min-h-0 content-start gap-3 overflow-hidden">
              {next.map((w, i) => (
                <li key={w.token} className={cn('flex items-center gap-5 rounded-2xl px-6', i === 0 ? 'bg-gradient-to-r from-primary/40 to-primary/10 py-5 ring-1 ring-inset ring-white/20' : 'bg-white/[0.06] py-3.5')}>
                  <span className={cn('font-bold tabular', i === 0 ? 'text-6xl' : 'text-4xl')}>{tk(w.token)}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-white/75', i === 0 ? 'text-3xl' : 'text-2xl')}>{w.pet ?? ''}</span>
                  {i === 0 && <span className="rounded-full bg-white px-4 py-1 text-lg font-bold uppercase tracking-wide text-[hsl(232_45%_10%)]">Next</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-3xl text-white/50">No one is waiting.</p>
          )}
          {d.waiting.length > next.length && <p className="mt-4 text-xl text-white/50">+ {d.waiting.length - next.length} more waiting</p>}
          <p className="mt-auto pt-6 text-xl text-white/45">{d.seenToday} seen today</p>
        </section>
      </main>

      <Ticker items={ticker} />

      {/* New call: takes over the screen for a few seconds. */}
      {announcing && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gradient-to-br from-primary to-[hsl(232_45%_12%)] text-center duration-500 animate-in fade-in zoom-in-95">
          <p className="text-4xl font-semibold uppercase tracking-[0.4em] text-white/75">Token</p>
          <p className="text-[clamp(12rem,24vw,22rem)] font-black leading-none tabular tracking-tighter drop-shadow-2xl">{tk(announcing.token)}</p>
          <p className="mt-6 text-[clamp(3rem,6vw,6rem)] font-bold">{announcing.room ? `Please go to ${announcing.room}` : 'Please come in'}</p>
          {announcing.pet && <p className="mt-4 text-4xl text-white/80">{announcing.pet}</p>}
        </div>
      )}

      {q.isError && (
        <p className="absolute right-8 top-8 z-30 flex items-center gap-2 rounded-full bg-destructive px-5 py-2 text-lg font-semibold">
          <WifiOff className="h-5 w-5" /> Reconnecting…
        </p>
      )}

      {/* Browsers only allow sound after a first tap: one tap starts the screen. */}
      {!started && (
        <button
          type="button"
          onClick={() => {
            setStarted(true);
            chime();
            void document.documentElement.requestFullscreen?.().catch(() => undefined);
          }}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/75 text-center backdrop-blur-sm"
        >
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white/15">
            <Volume2 className="h-14 w-14" />
          </span>
          <span className="text-4xl font-bold">Tap or click to start the screen</span>
          <span className="flex items-center gap-2 text-xl text-white/70">
            <Maximize className="h-5 w-5" /> Turns on full screen and the call sound
          </span>
        </button>
      )}
    </div>
  );
}

export default function DisplayPage() {
  return <Display />;
}
