'use client';
import { useQuery } from '@tanstack/react-query';
import { brandThemeCss, callAnnouncement, type Branding } from '@vcms/shared';
import { Maximize, Volume2, WifiOff } from 'lucide-react';
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
}

/** A soft two-note chime (no sound file needed). */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [
      [880, 0],
      [660, 0.28],
    ].forEach(([f, at]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 1);
    });
    setTimeout(() => void ctx.close(), 2000);
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
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {
    /* no speech */
  }
}

/** Live clock in the branch's time zone. */
function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <p className="text-5xl font-bold tabular tracking-tight">{branchTime(now, tz, 'h:mm')}<span className="ml-1 text-2xl font-semibold opacity-60">{branchTime(now, tz, 'a')}</span></p>
      <p className="text-lg opacity-70">{branchTime(now, tz, 'EEEE d MMMM')}</p>
    </div>
  );
}

/**
 * The waiting-room TV: who is called to which room (big, with a chime and a spoken announcement), the latest
 * calls, and the tokens still waiting. Opened by its secret link on a TV or monitor; refreshes every 3 seconds.
 */
function Display() {
  const { key } = useParams<{ key: string }>();
  const q = useQuery({ queryKey: ['display', key], queryFn: () => api.get<Screen>(`/public/waiting-room/display/${key}`), refetchInterval: 3000, retry: 1 });
  const [started, setStarted] = useState(false);
  const [flash, setFlash] = useState(false);
  const seen = useRef<string | null>(null);
  const d = q.data;
  const latest = d?.calls[0];

  // A new call (or a repeat of one): chime, read it out, and flash the big card.
  useEffect(() => {
    if (!latest) return;
    const sig = `${latest.id}:${latest.callCount}`;
    if (seen.current === null) {
      seen.current = sig; // what was already on screen when it opened is not announced
      return;
    }
    if (sig === seen.current) return;
    seen.current = sig;
    setFlash(true);
    setTimeout(() => setFlash(false), 6000);
    if (started) {
      chime();
      if (d?.announce) setTimeout(() => speak(callAnnouncement(latest.token, latest.room)), 900);
    }
  }, [latest, started, d?.announce]);

  // Keep the TV from going to sleep.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (started && nav.wakeLock) nav.wakeLock.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, [started]);

  if (q.isLoading) return <div className="min-h-screen bg-[hsl(236_40%_7%)]" />;
  if (!d)
    return (
      <div className="grid min-h-screen place-items-center bg-[hsl(236_40%_7%)] p-10 text-center text-white">
        <div>
          <p className="text-3xl font-semibold">This screen is not available</p>
          <p className="mt-2 text-lg opacity-70">The link may have been changed or the screen switched off in Settings → Waiting room.</p>
        </div>
      </div>
    );

  const css = brandThemeCss(d.clinic.branding);
  const logo = d.clinic.branding.logoUrl;
  const recent = d.calls.slice(1, 6);
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[hsl(236_40%_7%)] text-white" style={{ backgroundImage: 'radial-gradient(900px 600px at 10% -10%, hsl(var(--primary) / 0.45), transparent 60%), radial-gradient(800px 600px at 110% 110%, hsl(var(--brand-2) / 0.35), transparent 60%)' }}>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {/* Header */}
      <header className="flex items-center gap-6 px-12 pb-6 pt-10">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-20 max-w-[220px] rounded-2xl bg-white/95 object-contain p-2" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-brand-2 text-4xl font-bold">{d.clinic.name.charAt(0)}</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-5xl font-bold tracking-tight">{d.clinic.name}</h1>
          <p className="mt-1 text-xl opacity-70">{d.branch.name}</p>
        </div>
        <Clock tz={d.branch.timezone} />
      </header>

      <main className="grid flex-1 gap-8 px-12 pb-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Now calling */}
        <section className="flex flex-col gap-6">
          <div className={cn('relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[0.07] p-10 text-center shadow-2xl backdrop-blur-xl transition-all duration-500', flash && 'scale-[1.01] border-white/40 bg-white/[0.14]')}>
            {flash && <span aria-hidden className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/30 to-brand-2/20" />}
            <p className="relative text-2xl font-semibold uppercase tracking-[0.3em] opacity-70">{latest ? 'Now calling' : 'Welcome'}</p>
            {latest ? (
              <>
                <p className="relative mt-4 text-[clamp(7rem,16vw,15rem)] font-black leading-none tabular tracking-tighter">{latest.token}</p>
                <p className="relative mt-6 text-[clamp(2.5rem,5vw,4.5rem)] font-bold">{latest.room ? <>→ {latest.room}</> : 'Please come in'}</p>
                {latest.pet && <p className="relative mt-3 text-3xl opacity-80">{latest.pet}</p>}
              </>
            ) : (
              <p className="relative mt-6 max-w-2xl text-4xl font-semibold leading-snug opacity-90">Please take a seat. Your token number will be called on this screen.</p>
            )}
          </div>
          {recent.length > 0 && (
            <div className="grid gap-3">
              <p className="text-lg font-semibold uppercase tracking-[0.2em] opacity-60">Called before</p>
              <div className="grid grid-cols-5 gap-3">
                {recent.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-center">
                    <p className="text-4xl font-bold tabular">{c.token}</p>
                    <p className="truncate text-lg opacity-70">{c.room ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Waiting */}
        <section className="flex flex-col rounded-[2.5rem] border border-white/10 bg-white/[0.05] p-8 backdrop-blur-xl">
          <div className="mb-6 flex items-baseline justify-between">
            <p className="text-2xl font-semibold uppercase tracking-[0.2em] opacity-70">Waiting</p>
            <p className="text-2xl font-bold tabular opacity-90">{d.waiting.length}</p>
          </div>
          {d.waiting.length ? (
            <div className="grid content-start gap-3 sm:grid-cols-2">
              {d.waiting.slice(0, 14).map((w) => (
                <div key={w.token} className="flex items-center gap-4 rounded-2xl bg-white/[0.07] px-5 py-4">
                  <span className="text-4xl font-bold tabular">{w.token}</span>
                  {w.pet && <span className="truncate text-xl opacity-75">{w.pet}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-2xl opacity-60">No one is waiting.</p>
          )}
          {d.waiting.length > 14 && <p className="mt-4 text-xl opacity-60">+ {d.waiting.length - 14} more</p>}
        </section>
      </main>

      {d.message && (
        <footer className="border-t border-white/10 bg-black/20 px-12 py-5 text-center text-2xl font-medium opacity-90">{d.message}</footer>
      )}

      {q.isError && (
        <p className="absolute right-6 top-6 flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-sm font-semibold">
          <WifiOff className="h-4 w-4" /> Reconnecting…
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
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-black/70 text-center backdrop-blur-sm"
        >
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white/15">
            <Volume2 className="h-14 w-14" />
          </span>
          <span className="text-4xl font-bold">Tap or click to start the screen</span>
          <span className="flex items-center gap-2 text-xl opacity-75">
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
