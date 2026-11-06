'use client';
import { useQuery } from '@tanstack/react-query';
import type { DiaryBooklet, DiaryEntry } from '@vcms/shared';
import { CalendarClock, Printer, ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useClinic, VerifyShell } from '@/components/certificates/verify-view';
import { DiaryPreview, DiaryPrintRoot, type DiaryStyle } from '@/components/diary/diary-pages';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDateOnly } from '@/lib/format';

/** What is coming up: the next-due dates in the diary that have not passed, soonest first. */
function comingUp(b: DiaryBooklet) {
  const today = b.diary.generatedOn;
  const d = b.diary;
  const out: { label: string; date: string; overdue: boolean }[] = [];
  const add = (label: string, list: DiaryEntry[]) => {
    // Only the latest entry of each kind matters for "next due".
    const last = [...list].filter((e) => e.validUntil).sort((x, y) => (y.validUntil ?? '').localeCompare(x.validUntil ?? ''))[0];
    if (last?.validUntil) out.push({ label, date: last.validUntil, overdue: last.validUntil < today });
  };
  add('Rabies vaccination', d.rabies);
  add('Vaccination', d.vaccinations);
  add('Deworming', d.deworming);
  add('Tick & flea treatment', d.tickFlea);
  for (const t of d.futureTests) if (t.plannedFor) out.push({ label: 'Rabies antibody test', date: t.plannedFor, overdue: t.plannedFor < today });
  return out.sort((a, b2) => a.date.localeCompare(b2.date));
}

function OnlineDiary({ token }: { token: string }) {
  const { logo, color } = useClinic();
  const q = useQuery({ queryKey: ['public-diary', token], queryFn: () => api.get<DiaryBooklet>(`/public/diary/${encodeURIComponent(token)}`), retry: false, staleTime: 60_000 });
  const b = q.data;
  const style: DiaryStyle | null = useMemo(
    () => (b ? { accent: color ?? '#0d7a70', logoUrl: logo, photoUrl: b.diary.patient.photoAttachmentId ? `/api/v1/public/diary/${encodeURIComponent(token)}/photo` : null } : null),
    [b, color, logo, token],
  );
  if (q.isLoading) return <div className="rounded-2xl surface-strong p-10 text-center text-sm text-muted-foreground shadow-pop">Opening the diary…</div>;
  if (q.error || !b || !style) {
    return (
      <div className="grid gap-2 rounded-2xl surface-strong p-8 text-center shadow-pop">
        <p className="text-lg font-semibold">This diary link isn’t working</p>
        <p className="text-sm text-muted-foreground">The link may have been replaced, or it was copied incompletely. Please ask the clinic for a new link.</p>
      </div>
    );
  }
  const P = b.diary.patient;
  const soon = comingUp(b);
  return (
    <div className="grid gap-5">
      <section className="rounded-2xl surface-strong p-5 shadow-pop sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{b.settings.title}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{P.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{[P.species, P.breed, P.age].filter(Boolean).join(' · ')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print or save as PDF</Button>
        </div>
        {b.diary.identifiers.find((i) => i.type === 'MICROCHIP') && (
          <p className="mt-3 flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" /> Microchip <span className="font-mono font-semibold tracking-wider">{b.diary.identifiers.find((i) => i.type === 'MICROCHIP')!.value}</span></p>
        )}
        {soon.length > 0 && (
          <div className="mt-4 grid gap-2 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Coming up</p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {soon.map((s) => (
                <li key={`${s.label}${s.date}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2">
                  <span>{s.label}</span>
                  <span className={s.overdue ? 'font-semibold text-destructive' : 'font-semibold'}>{s.overdue ? `Was due ${fmtDateOnly(s.date)}` : fmtDateOnly(s.date)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">Kept up to date by {b.diary.clinic.name}. To change anything, please contact the clinic{b.diary.clinic.phone ? ` on ${b.diary.clinic.phone}` : ''}.</p>
      </section>
      <DiaryPreview booklet={b} style={style} maxCell={480} />
      <DiaryPrintRoot booklet={b} style={style} />
    </div>
  );
}

/** Public: the page the owner’s link and the QR code in the pet diary open. */
export default function OnlineDiaryPage() {
  const { token } = useParams<{ token: string }>();
  return (
    <VerifyShell title="Pet diary" note="This private link opens the diary for one animal. Please don’t share it publicly." wide>
      <OnlineDiary token={token} />
    </VerifyShell>
  );
}
