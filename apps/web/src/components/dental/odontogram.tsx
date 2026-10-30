'use client';
import { dentalFinding, dentalProcedure, type ToothInfo, type ToothType } from '@vcms/shared';
import { cn } from '@/lib/utils';
import type { DentalProcedureRow, DentalTooth } from '@/lib/types';

const WIDTH: Record<ToothType, number> = { incisor: 20, canine: 25, premolar: 28, molar: 34 };
const GAP = 4;
const MID = 18; // gap at the midline
const SIDE = 26; // room for "R" / "L"
const TOOTH_H = 70;
const LABEL_H = 28;
const BITE = 20; // gap between the jaws

/** Outline of a tooth in a w × h box, root up (upper jaw); the lower jaw is drawn mirrored. */
function shapes(type: ToothType, w: number, h: number) {
  const c0 = h * 0.5; // where crown meets root
  const r = (x: number) => x.toFixed(1);
  let crown: string;
  let roots: string[];
  if (type === 'incisor') {
    crown = `M2 ${r(c0)} H${r(w - 2)} V${r(h - 6)} Q${r(w - 2)} ${r(h - 1)} ${r(w / 2)} ${r(h - 1)} Q2 ${r(h - 1)} 2 ${r(h - 6)} Z`;
    roots = [`M${r(w * 0.22)} ${r(c0 + 1)} Q${r(w * 0.3)} 6 ${r(w / 2)} 4 Q${r(w * 0.7)} 6 ${r(w * 0.78)} ${r(c0 + 1)} Z`];
  } else if (type === 'canine') {
    crown = `M2 ${r(c0)} H${r(w - 2)} Q${r(w - 2)} ${r(h * 0.82)} ${r(w / 2)} ${r(h - 0.5)} Q2 ${r(h * 0.82)} 2 ${r(c0)} Z`;
    roots = [`M${r(w * 0.18)} ${r(c0 + 1)} Q${r(w * 0.25)} 2 ${r(w / 2)} 0.5 Q${r(w * 0.75)} 2 ${r(w * 0.82)} ${r(c0 + 1)} Z`];
  } else if (type === 'premolar') {
    crown = `M2 ${r(c0)} H${r(w - 2)} V${r(h - 9)} Q${r(w * 0.8)} ${r(h - 1)} ${r(w * 0.62)} ${r(h - 7)} Q${r(w / 2)} ${r(h - 10)} ${r(w * 0.38)} ${r(h - 7)} Q${r(w * 0.2)} ${r(h - 1)} 2 ${r(h - 9)} Z`;
    roots = [
      `M${r(w * 0.1)} ${r(c0 + 1)} Q${r(w * 0.14)} 10 ${r(w * 0.28)} 7 Q${r(w * 0.42)} 10 ${r(w * 0.46)} ${r(c0 + 1)} Z`,
      `M${r(w * 0.54)} ${r(c0 + 1)} Q${r(w * 0.58)} 10 ${r(w * 0.72)} 7 Q${r(w * 0.86)} 10 ${r(w * 0.9)} ${r(c0 + 1)} Z`,
    ];
  } else {
    crown = `M2 ${r(c0)} H${r(w - 2)} V${r(h - 9)} Q${r(w * 0.88)} ${r(h - 1)} ${r(w * 0.72)} ${r(h - 7)} Q${r(w * 0.6)} ${r(h - 10)} ${r(w / 2)} ${r(h - 5)} Q${r(w * 0.4)} ${r(h - 10)} ${r(w * 0.28)} ${r(h - 7)} Q${r(w * 0.12)} ${r(h - 1)} 2 ${r(h - 9)} Z`;
    roots = [
      `M${r(w * 0.08)} ${r(c0 + 1)} Q${r(w * 0.1)} 12 ${r(w * 0.22)} 9 Q${r(w * 0.34)} 12 ${r(w * 0.36)} ${r(c0 + 1)} Z`,
      `M${r(w * 0.39)} ${r(c0 + 1)} Q${r(w * 0.42)} 14 ${r(w / 2)} 12 Q${r(w * 0.58)} 14 ${r(w * 0.61)} ${r(c0 + 1)} Z`,
      `M${r(w * 0.64)} ${r(c0 + 1)} Q${r(w * 0.66)} 12 ${r(w * 0.78)} 9 Q${r(w * 0.9)} 12 ${r(w * 0.92)} ${r(c0 + 1)} Z`,
    ];
  }
  return { crown, roots };
}

export type ToothTone = 'healthy' | 'finding' | 'severe' | 'absent' | 'unerupted';

/** How a tooth is drawn: absent, unerupted, with findings, or with advanced disease. */
export function toothTone(t: DentalTooth | undefined): ToothTone {
  if (!t) return 'healthy';
  if (t.state === 'MISSING' || t.state === 'EXTRACTED') return 'absent';
  if (t.state === 'UNERUPTED') return 'unerupted';
  if ((t.pdStage ?? 0) >= 3 || (t.mobility ?? 0) >= 2 || (t.trStage ?? 0) >= 3 || t.findings.some((f) => f === 'FX_CCF' || f === 'PA' || f === 'OM')) return 'severe';
  if (t.findings.length || (t.pdStage ?? 0) > 0 || (t.mobility ?? 0) > 0 || (t.calculus ?? 0) > 0 || (t.gingivitis ?? 0) > 0 || (t.furcation ?? 0) > 0) return 'finding';
  return 'healthy';
}

const FILL: Record<ToothTone, { crown: string; root: string; stroke: string }> = {
  healthy: { crown: 'hsl(var(--card))', root: 'hsl(var(--muted))', stroke: 'hsl(var(--foreground) / 0.45)' },
  finding: { crown: 'hsl(var(--warning) / 0.28)', root: 'hsl(var(--warning) / 0.12)', stroke: 'hsl(var(--warning))' },
  severe: { crown: 'hsl(var(--destructive) / 0.25)', root: 'hsl(var(--destructive) / 0.1)', stroke: 'hsl(var(--destructive))' },
  absent: { crown: 'transparent', root: 'transparent', stroke: 'hsl(var(--foreground) / 0.3)' },
  unerupted: { crown: 'hsl(var(--info) / 0.12)', root: 'transparent', stroke: 'hsl(var(--info))' },
};

/** Short codes printed under a tooth: findings (TR with its stage), PD stage, mobility. */
export function toothCodes(t: DentalTooth | undefined) {
  if (!t) return [];
  const codes = t.findings.map((f) => (f === 'TR' && t.trStage ? `TR${t.trStage}` : (dentalFinding(f)?.abbr ?? f)));
  if (t.pdStage != null && t.pdStage > 0) codes.push(`PD${t.pdStage}`);
  if (t.mobility != null && t.mobility > 0) codes.push(`M${t.mobility}`);
  if (t.state === 'MISSING') codes.unshift('O');
  return codes;
}

interface Row {
  teeth: ToothInfo[];
  width: number;
}

function row(teeth: ToothInfo[], quadrantLeft: number, quadrantRight: number): { left: Row; right: Row } {
  const q = (n: number, desc: boolean) => teeth.filter((t) => t.quadrant === n).sort((a, b) => (desc ? b.position - a.position : a.position - b.position));
  const width = (list: ToothInfo[]) => list.reduce((n, t) => n + WIDTH[t.type] + GAP, -GAP);
  const left = q(quadrantLeft, true);
  const right = q(quadrantRight, false);
  return { left: { teeth: left, width: width(left) }, right: { teeth: right, width: width(right) } };
}

/**
 * Tooth chart as the vet sees the patient: the patient's right on the left. Upper jaw on top (roots up), lower jaw
 * below; teeth by Triadan number. Click (or Enter/Space) toggles a tooth in the selection.
 */
export function Odontogram({
  teeth,
  findings,
  procedures,
  selected,
  onToggle,
  readOnly,
  title,
  className,
}: {
  teeth: ToothInfo[];
  findings: DentalTooth[];
  procedures: DentalProcedureRow[];
  selected?: ReadonlySet<string>;
  onToggle?: (tooth: string) => void;
  readOnly?: boolean;
  title?: string;
  className?: string;
}) {
  const deciduous = teeth[0]?.deciduous ?? false;
  const [qUR, qUL, qLL, qLR] = deciduous ? [5, 6, 7, 8] : [1, 2, 3, 4];
  const upper = row(teeth, qUR, qUL);
  const lower = row(teeth, qLR, qLL);
  const half = Math.max(upper.left.width, upper.right.width, lower.left.width, lower.right.width);
  const W = SIDE * 2 + half * 2 + MID;
  const H = LABEL_H * 2 + TOOTH_H * 2 + BITE;
  const cx = W / 2;
  const byTooth = new Map(findings.map((f) => [f.tooth, f]));
  const procs = new Map<string, DentalProcedureRow[]>();
  for (const p of procedures) if (p.tooth) procs.set(p.tooth, [...(procs.get(p.tooth) ?? []), p]);

  const draw = (r: Row, side: 'left' | 'right', upperJaw: boolean) => {
    let x = side === 'left' ? cx - MID / 2 - r.width : cx + MID / 2;
    const y = upperJaw ? LABEL_H : LABEL_H + TOOTH_H + BITE;
    return r.teeth.map((t) => {
      const w = WIDTH[t.type];
      const gx = x;
      x += w + GAP;
      const f = byTooth.get(t.id);
      const tone = toothTone(f);
      const colours = FILL[tone];
      const { crown, roots } = shapes(t.type, w, TOOTH_H);
      const here = procs.get(t.id) ?? [];
      const extractedNow = here.some((p) => dentalProcedure(p.code)?.removesTooth);
      const treated = here.some((p) => !dentalProcedure(p.code)?.removesTooth);
      const isSelected = selected?.has(t.id) ?? false;
      const codes = toothCodes(f);
      const dashed = tone === 'absent' || tone === 'unerupted' || extractedNow;
      const labelY = upperJaw ? LABEL_H - 16 : y + TOOTH_H + 12;
      const codeY = upperJaw ? LABEL_H - 5 : y + TOOTH_H + 23;
      const name = `${t.name}${codes.length ? ` — ${codes.join(', ')}` : ''}${extractedNow ? ' — extracted at this visit' : ''}${here.length ? ` — ${here.map((p) => p.label).join(', ')}` : ''}`;
      return (
        <g
          key={t.id}
          role={readOnly ? 'img' : 'button'}
          aria-label={name}
          aria-pressed={readOnly ? undefined : isSelected}
          tabIndex={readOnly ? undefined : 0}
          className={cn('outline-none', !readOnly && 'cursor-pointer [&:focus-visible>rect.focus]:opacity-100')}
          onClick={readOnly ? undefined : () => onToggle?.(t.id)}
          onKeyDown={
            readOnly
              ? undefined
              : (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle?.(t.id);
                  }
                }
          }
        >
          <title>{name}</title>
          {/* Selection and keyboard focus. */}
          <rect x={gx - 2} y={upperJaw ? 2 : y - 2} width={w + 4} height={TOOTH_H + LABEL_H} rx={6} fill={isSelected ? 'hsl(var(--primary) / 0.14)' : 'transparent'} stroke={isSelected ? 'hsl(var(--primary))' : 'transparent'} strokeWidth={1.5} />
          <rect className="focus opacity-0" x={gx - 3} y={upperJaw ? 1 : y - 3} width={w + 6} height={TOOTH_H + LABEL_H + 2} rx={7} fill="none" stroke="hsl(var(--ring))" strokeWidth={2} />
          <g transform={upperJaw ? `translate(${gx} ${y})` : `translate(${gx} ${y + TOOTH_H}) scale(1 -1)`} opacity={tone === 'absent' ? 0.55 : 1}>
            {roots.map((d, i) => (
              <path key={i} d={d} fill={colours.root} stroke={colours.stroke} strokeWidth={1} strokeDasharray={dashed ? '3 2' : undefined} />
            ))}
            <path d={crown} fill={colours.crown} stroke={colours.stroke} strokeWidth={1.3} strokeDasharray={dashed ? '3 2' : undefined} />
            {/* Calculus on the crown: a band whose height follows the calculus index. */}
            {!!f?.calculus && tone !== 'absent' && <rect x={3} y={TOOTH_H * 0.5 + 1} width={w - 6} height={f.calculus * 3} rx={1.5} fill="hsl(var(--warning) / 0.6)" />}
            {treated && <circle cx={w / 2} cy={TOOTH_H * 0.74} r={3.2} fill="hsl(var(--info))" />}
          </g>
          {/* Extracted (now or before): a cross over the tooth. */}
          {(extractedNow || f?.state === 'EXTRACTED') && (
            <g stroke={extractedNow ? 'hsl(var(--destructive))' : 'hsl(var(--foreground) / 0.45)'} strokeWidth={extractedNow ? 2.2 : 1.5} strokeLinecap="round">
              <line x1={gx + 3} y1={y + 6} x2={gx + w - 3} y2={y + TOOTH_H - 6} />
              <line x1={gx + w - 3} y1={y + 6} x2={gx + 3} y2={y + TOOTH_H - 6} />
            </g>
          )}
          <text x={gx + w / 2} y={labelY} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={isSelected ? 'hsl(var(--primary))' : 'hsl(var(--foreground) / 0.75)'} className="tabular select-none">
            {t.id}
          </text>
          {!!codes.length && (
            <text x={gx + w / 2} y={codeY} textAnchor="middle" fontSize={7.5} fontWeight={700} fill={tone === 'severe' ? 'hsl(var(--destructive))' : tone === 'absent' ? 'hsl(var(--muted-foreground))' : 'hsl(var(--warning))'} className="select-none">
              {codes.length > 2 ? `${codes.slice(0, 1).join('')}+${codes.length - 1}` : codes.join(' ')}
            </text>
          )}
        </g>
      );
    });
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block h-auto w-full min-w-[560px] max-w-[980px]" role="group" aria-label={title ?? (deciduous ? 'Baby teeth' : 'Adult teeth')}>
        {/* Jaws, midline and sides (the patient's right is on the left). */}
        <line x1={SIDE} x2={W - SIDE} y1={LABEL_H + TOOTH_H + BITE / 2} y2={LABEL_H + TOOTH_H + BITE / 2} stroke="hsl(var(--foreground) / 0.12)" strokeDasharray="4 4" />
        <line x1={cx} x2={cx} y1={6} y2={H - 6} stroke="hsl(var(--foreground) / 0.12)" />
        <text x={SIDE / 2} y={H / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="hsl(var(--muted-foreground))">R</text>
        <text x={W - SIDE / 2} y={H / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="hsl(var(--muted-foreground))">L</text>
        <text x={cx} y={LABEL_H + TOOTH_H + BITE / 2 + 3.5} textAnchor="middle" fontSize={8} fill="hsl(var(--muted-foreground))" className="select-none" style={{ paintOrder: 'stroke' }} stroke="hsl(var(--card))" strokeWidth={4}>
          {deciduous ? 'baby teeth' : 'upper / lower'}
        </text>
        {draw(upper.left, 'left', true)}
        {draw(upper.right, 'right', true)}
        {draw(lower.left, 'left', false)}
        {draw(lower.right, 'right', false)}
      </svg>
    </div>
  );
}

/** Colour key under the chart. */
export function OdontogramLegend({ className }: { className?: string }) {
  const sw = (fill: string, stroke: string, dashed = false) => (
    <svg width="14" height="14" aria-hidden className="shrink-0">
      <rect x="1.5" y="1.5" width="11" height="11" rx="3" fill={fill} stroke={stroke} strokeDasharray={dashed ? '2 1.5' : undefined} />
    </svg>
  );
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)}>
      <span className="flex items-center gap-1.5">{sw(FILL.healthy.crown, FILL.healthy.stroke)} Nothing found</span>
      <span className="flex items-center gap-1.5">{sw(FILL.finding.crown, FILL.finding.stroke)} Finding</span>
      <span className="flex items-center gap-1.5">{sw(FILL.severe.crown, FILL.severe.stroke)} Needs attention (PD3+, loose, pulp exposed…)</span>
      <span className="flex items-center gap-1.5">{sw('transparent', FILL.absent.stroke, true)} Missing</span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden><g stroke="hsl(var(--destructive))" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="3" x2="11" y2="11" /><line x1="11" y1="3" x2="3" y2="11" /></g></svg> Extracted
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="3.5" fill="hsl(var(--info))" /></svg> Treated
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="14" aria-hidden><rect x="2" y="5" width="10" height="4" rx="1.5" fill="hsl(var(--warning) / 0.6)" /></svg> Tartar
      </span>
    </div>
  );
}
