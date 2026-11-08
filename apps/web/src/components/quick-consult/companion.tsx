'use client';
import { AlertOctagon, CalendarClock, Check, ClipboardCheck, History, Info, Pill, Scale, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { ageText, type usePatientContext } from './use-patient-context';
import type { VisitReason } from './visit-reasons';
import { fmtDateTime } from '@/lib/format';
import type { Encounter } from '@/lib/types';
import { useUnits } from '@/lib/units';
import { cn } from '@/lib/utils';

const VITAL_NAMES: Record<string, string> = {
  temperatureC: 'Temperature',
  heartRate: 'Heart rate',
  respiratoryRate: 'Breathing rate',
  weightKg: 'Weight',
  capillaryRefillSec: 'Capillary refill',
  painScore: 'Pain score',
  systolicBp: 'Blood pressure',
  diastolicBp: 'Blood pressure',
  spo2: 'Oxygen (SpO₂)',
};
const day = (iso: string) => fmtDateTime(iso).split(',')[0];

function Card({ icon: Icon, title, tone = 'default', children }: { icon: React.ComponentType<{ className?: string }>; title: string; tone?: 'default' | 'warn' | 'danger' | 'good'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-xl border px-3.5 py-3 text-sm',
        tone === 'danger' && 'border-destructive/40 bg-destructive/5',
        tone === 'warn' && 'border-warning/50 bg-warning/5',
        tone === 'good' && 'border-success/40 bg-success/5',
        tone === 'default' && 'border-border/70 bg-card',
      )}
    >
      <p className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : 'text-muted-foreground')}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <div className="grid gap-1 leading-snug">{children}</div>
    </div>
  );
}

/**
 * The assistant beside the steps: briefs the vet before they start, then shows, at each step, only what helps with
 * that step — the last weight when measuring, the last diagnosis when diagnosing, allergies when treating.
 */
export function Companion({
  step,
  enc,
  ctx,
  reason,
  wordsWritten,
  onOpenHistory,
  checklist,
}: {
  step: number;
  enc: Encounter;
  ctx: ReturnType<typeof usePatientContext>;
  reason: VisitReason | null;
  wordsWritten: number;
  onOpenHistory: () => void;
  checklist: { label: string; done: boolean }[];
}) {
  const u = useUnits();
  const p = enc.patient;
  const name = p.name;
  const latest = enc.vitals[0] ?? null;
  const flagged = latest?.flags ? [...new Set(Object.entries(latest.flags).map(([k, f]) => `${VITAL_NAMES[k] ?? k} ${f.flag === 'HIGH' ? 'above' : 'below'} range`))] : [];
  const allergies = (p.alerts ?? []).filter((a) => a.type === 'ALLERGY' || a.type === 'MEDICATION' || a.severity === 'CRITICAL');
  const nowKg = enc.vitals.find((v) => v.weightKg != null)?.weightKg ?? null;
  const lw = ctx.lastWeight;
  const change = nowKg != null && lw ? Number(nowKg) - lw.kg : null;
  const lv = ctx.lastVisit;
  const minutesSaved = Math.round(wordsWritten / 30);

  const age = ageText(p.dateOfBirth, p.dobEstimated);
  const sex = p.sex ? p.sex.toLowerCase().replace(/_/g, ' ') : null;

  return (
    <div className="grid content-start gap-3">
      <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 px-3.5 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Consultation assistant</p>
          <p className="text-xs text-muted-foreground">{wordsWritten > 0 ? `${wordsWritten} words written for you${minutesSaved >= 1 ? ` · ~${minutesSaved} min of typing saved` : ''}` : 'I’ll write the record as you tap.'}</p>
        </div>
      </div>

      {/* Allergies and critical alerts: always first, at every step. */}
      {allergies.length > 0 && (
        <Card icon={AlertOctagon} title="Alerts" tone="danger">
          {allergies.map((a) => (
            <p key={a.id}>
              <b>{a.title}</b>
              {a.substance && ` — ${a.substance}`}
              {a.reaction && ` (${a.reaction})`}
            </p>
          ))}
        </Card>
      )}

      {/* Briefing before the vet starts. */}
      {step <= 1 && (
        <>
          <Card icon={Info} title={`${name} at a glance`}>
            <p>{[p.species.name, sex, age].filter(Boolean).join(' · ')}</p>
            <p>{p.latestWeightKg != null ? `Last weight ${u.weight(p.latestWeightKg)}` : 'No weight on record yet'}</p>
            <p className="text-muted-foreground">{ctx.visitCount ? `${ctx.visitCount} earlier visit${ctx.visitCount === 1 ? '' : 's'} at this clinic` : 'First visit to this clinic'}</p>
          </Card>
          {lv && (
            <Card icon={History} title={`Last visit · ${day(lv.at)}`}>
              {lv.complaint && <p>{lv.complaint}</p>}
              {lv.diagnoses.length > 0 && (
                <p>
                  <span className="text-muted-foreground">Diagnosis:</span> {lv.diagnoses.map((d) => d.term).join(', ')}
                </p>
              )}
              {lv.medicines.length > 0 && (
                <p>
                  <span className="text-muted-foreground">Medicines:</span> {lv.medicines.join(', ')}
                </p>
              )}
              {lv.clinician && <p className="text-xs text-muted-foreground">Seen by {lv.clinician}</p>}
              <button type="button" onClick={onOpenHistory} className="w-fit text-xs font-medium text-primary hover:underline">
                Open full history
              </button>
            </Card>
          )}
          {ctx.careSummary.length > 0 && (
            <Card icon={ClipboardCheck} title="On record">
              {ctx.careSummary.slice(0, 4).map((s) => (
                <p key={s.title}>
                  <span className="text-muted-foreground">{s.title}:</span> {s.items.slice(0, 2).join('; ')}
                  {s.items.length > 2 && ` +${s.items.length - 2} more`}
                </p>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Measure: the last weight and how it changed. */}
      {step === 2 && (
        <Card icon={Scale} title="Weight">
          {lw ? <p>Last time: {u.weight(lw.kg)} on {day(lw.at)}</p> : <p>No earlier weight to compare with.</p>}
          {change != null && Math.abs(change) >= 0.01 && (
            <p className={cn('flex items-center gap-1 font-medium', change < 0 ? 'text-warning' : 'text-foreground')}>
              {change < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              {change > 0 ? '+' : '−'}
              {u.weight(Math.abs(change))} since then ({Math.round((Math.abs(change) / lw!.kg) * 100)}%)
            </p>
          )}
          {change != null && Math.abs(change) < 0.01 && <p className="flex items-center gap-1 text-success"><Check className="h-4 w-4" /> Same as last time</p>}
        </Card>
      )}

      {/* Vitals outside the clinic's own reference ranges: shown while examining and diagnosing. */}
      {step >= 2 && step <= 4 && flagged.length > 0 && (
        <Card icon={AlertOctagon} title="Worth a look" tone="warn">
          {flagged.map((f) => (
            <p key={f}>{f}</p>
          ))}
          <p className="text-xs text-muted-foreground">Compared with your clinic’s reference ranges.</p>
        </Card>
      )}

      {/* Diagnosis and treatment: what was found and given last time. */}
      {(step === 4 || step === 5) && lv && (lv.diagnoses.length > 0 || lv.medicines.length > 0) && (
        <Card icon={History} title={`Last time · ${day(lv.at)}`}>
          {step === 4 && lv.diagnoses.length > 0 && <p>{lv.diagnoses.map((d) => d.term).join(', ')}</p>}
          {step === 5 && lv.medicines.length > 0 && (
            <p className="flex items-start gap-1.5">
              <Pill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {lv.medicines.join(', ')}
            </p>
          )}
          {step === 5 && lv.plan && <p className="line-clamp-3 text-xs text-muted-foreground">{lv.plan}</p>}
        </Card>
      )}

      {step === 6 && lv?.advice && (
        <Card icon={History} title="Advice given last time">
          <p className="line-clamp-4">{lv.advice}</p>
        </Card>
      )}

      {/* Before signing: a calm check, nothing blocks. */}
      {step >= 6 && (
        <Card icon={CalendarClock} title="Before you finish" tone={checklist.every((c) => c.done) ? 'good' : 'default'}>
          {checklist.map((c) => (
            <p key={c.label} className={cn('flex items-center gap-1.5', !c.done && 'text-muted-foreground')}>
              {c.done ? <Check className="h-3.5 w-3.5 text-success" /> : <span className="mx-1 h-1.5 w-1.5 rounded-full bg-current" />}
              {c.label}
            </p>
          ))}
        </Card>
      )}
    </div>
  );
}
