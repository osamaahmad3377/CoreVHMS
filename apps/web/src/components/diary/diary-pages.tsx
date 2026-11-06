'use client';
import { DIARY_ROWS_PER_PAGE, SEROLOGY_OUTCOME_LABELS, chunk, type Diary, type DiaryBooklet, type DiaryEntry, type DiarySettings, type SerologyTestView } from '@vcms/shared';
import { Bug, CalendarClock, Fingerprint, FlaskConical, PawPrint, PenLine, Pill, Scissors, ShieldCheck, Stethoscope, Syringe, UserRound } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MM_TO_PX } from '../certificates/certificate-page';
import { fmtDateOnly } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The booklet's pages are A5 portrait. */
export const DIARY_PAGE = { w: 148, h: 210 } as const;

export interface DiaryStyle {
  /** The clinic's brand colour (or the colour chosen in Settings → Pet diary). */
  accent: string;
  logoUrl: string | null;
  /** The animal's photo, if there is one (the address differs for staff and for the owner's online page). */
  photoUrl: string | null;
}

/** A light brand colour is darkened until white text on it reads well (printed headers and covers are white on colour). */
export function readableAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#0d7a70';
  const n = parseInt(m[1], 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (c: number[]) => c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (let i = 0; i < 12 && lum(rgb) > 0.18; i++) rgb = rgb.map((v) => v * 0.88);
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

const INK = '#1f2937';
const MUTED = '#6b7280';
const SERIF = 'Georgia, "Times New Roman", Cambria, serif';
const MONO = 'ui-monospace, Menlo, monospace';
const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');
const day = (d: string | null | undefined) => (d ? fmtDateOnly(d) : '—');
/** A colour with some transparency (an 8-digit hex colour). */
const tint = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

interface Ctx {
  diary: Diary;
  settings: DiarySettings;
  qrValue: string | null;
  style: DiaryStyle;
}
type Icon = React.ComponentType<{ style?: React.CSSProperties }>;

/** A QR code as an inline picture, so it prints sharply at any size. */
function Qr({ value, color = '#111827', size }: { value: string; color?: string; size: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: color, light: '#0000' } })
      .then((s) => live && setSvg(s.replace('<svg ', '<svg width="100%" height="100%" ')))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [value, color]);
  return <span role="img" aria-label="QR code for the online diary" style={{ display: 'block', width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const pageBox = (extra: React.CSSProperties): React.CSSProperties => ({ width: `${DIARY_PAGE.w}mm`, height: `${DIARY_PAGE.h}mm`, color: INK, printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact', breakAfter: 'page', ...extra });

/** Frame of one inner page: the section title in the clinic's style, the animal, and a footer with the clinic and page number. */
function Sheet({ title, subtitle, icon: Icon, n, total, ctx, children }: { title: string; subtitle?: string; icon: Icon; n: number; total: number; ctx: Ctx; children: React.ReactNode }) {
  const { diary, settings, style } = ctx;
  const a = style.accent;
  const theme = settings.theme;
  const who = `${diary.patient.name} · ${diary.patient.patientNo}`;
  return (
    <section className="diary-page relative flex flex-col overflow-hidden" style={pageBox({ background: theme === 'ELEGANT' ? '#fffdf8' : '#fff' })}>
      {theme === 'MODERN' && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '3.2mm', background: a }} />}
      {theme === 'ELEGANT' && <div style={{ position: 'absolute', inset: '5mm', border: `0.25mm solid ${tint(a, 0.55)}`, pointerEvents: 'none' }} />}

      {theme === 'CLASSIC' && (
        <header style={{ background: a, color: '#fff', padding: '7mm 10mm 5mm', display: 'flex', alignItems: 'center', gap: '4mm' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '10mm', height: '10mm', borderRadius: '50%', background: 'rgba(255,255,255,0.18)', flexShrink: 0 }}>
            <Icon style={{ width: '5.4mm', height: '5.4mm' }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '14.5pt', fontWeight: 700, lineHeight: 1.15 }}>{title}</h2>
            {subtitle && <p style={{ fontSize: '7.8pt', opacity: 0.88, marginTop: '0.8mm', lineHeight: 1.35 }}>{subtitle}</p>}
          </div>
          <span style={{ fontSize: '7.5pt', opacity: 0.92, whiteSpace: 'nowrap', alignSelf: 'flex-start', marginTop: '0.5mm' }}>{who}</span>
        </header>
      )}
      {theme === 'MODERN' && (
        <header style={{ padding: '9mm 10mm 4mm 14mm', borderBottom: `0.3mm solid ${tint(a, 0.35)}`, margin: '0 0 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4mm' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3mm', minWidth: 0 }}>
              <Icon style={{ width: '6mm', height: '6mm', color: a, flexShrink: 0 }} />
              <h2 style={{ fontSize: '15pt', fontWeight: 800, color: a, lineHeight: 1.15 }}>{title}</h2>
            </div>
            <span style={{ fontSize: '7.5pt', color: MUTED, whiteSpace: 'nowrap' }}>{who}</span>
          </div>
          {subtitle && <p style={{ fontSize: '7.8pt', color: MUTED, marginTop: '1.2mm', lineHeight: 1.35, paddingLeft: '9mm' }}>{subtitle}</p>}
        </header>
      )}
      {theme === 'ELEGANT' && (
        <header style={{ padding: '11mm 12mm 3mm', textAlign: 'center' }}>
          <h2 style={{ fontFamily: SERIF, fontSize: '16pt', fontWeight: 700, color: a, letterSpacing: '0.04em', lineHeight: 1.15 }}>{title}</h2>
          {subtitle && <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '8pt', color: MUTED, marginTop: '1.2mm' }}>{subtitle}</p>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', justifyContent: 'center', marginTop: '3mm' }}>
            <span style={{ width: '22mm', height: '0.25mm', background: tint(a, 0.6) }} />
            <span style={{ width: '1.6mm', height: '1.6mm', background: a, transform: 'rotate(45deg)' }} />
            <span style={{ width: '22mm', height: '0.25mm', background: tint(a, 0.6) }} />
          </div>
        </header>
      )}

      <div style={{ flex: 1, padding: theme === 'ELEGANT' ? '5mm 13mm 0' : theme === 'MODERN' ? '6mm 10mm 0 14mm' : '7mm 10mm 0', minHeight: 0 }}>{children}</div>

      <footer style={{ display: 'flex', justifyContent: 'space-between', gap: '3mm', padding: theme === 'ELEGANT' ? '0 13mm 8mm' : theme === 'MODERN' ? '0 10mm 6mm 14mm' : '0 10mm 6mm', fontSize: '6.8pt', color: MUTED, fontFamily: theme === 'ELEGANT' ? SERIF : undefined }}>
        <span style={{ whiteSpace: 'nowrap' }}>{diary.clinic.name}</span>
        {settings.footerNote && <span style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>{settings.footerNote}</span>}
        <span style={{ whiteSpace: 'nowrap' }}>
          Page {n} of {total}
        </span>
      </footer>
    </section>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: '6.5pt', textTransform: 'uppercase', letterSpacing: '0.09em', color: MUTED, fontWeight: 600 }}>{children}</div>;

/** A label above a value, as on a form. */
function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined, borderBottom: '0.25mm solid #e5e7eb', paddingBottom: '1.6mm' }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ fontSize: '10.5pt', fontWeight: 600, marginTop: '0.6mm', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

const Fields = ({ children }: { children: React.ReactNode }) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '6mm', rowGap: '4.4mm' }}>{children}</div>;

/** A ruled table with a fixed number of rows, so every page looks the same and the blank rows can be stamped by hand. */
function Table({ columns, rows, size, empty, accent }: { columns: { label: string; width: string }[]; rows: React.ReactNode[][]; size: number; empty: string; accent: string }) {
  const blank = Math.max(0, size - rows.length);
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '8.4pt' }}>
        <thead>
          <tr style={{ background: tint(accent, 0.09) }}>
            {columns.map((c) => (
              <th key={c.label} style={{ width: c.width, textAlign: 'left', padding: '1.8mm 1.6mm', fontSize: '6.6pt', textTransform: 'uppercase', letterSpacing: '0.07em', color: accent, borderBottom: `0.5mm solid ${accent}`, fontWeight: 700 }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '1.8mm 1.6mm', borderBottom: '0.25mm solid #d1d5db', verticalAlign: 'top', overflowWrap: 'anywhere', lineHeight: 1.3, height: '15mm' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {Array.from({ length: blank }, (_, i) => (
            <tr key={`b${i}`}>
              {columns.map((c) => (
                <td key={c.label} style={{ borderBottom: '0.25mm solid #d1d5db', height: '15mm' }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p style={{ marginTop: '2mm', fontSize: '7.5pt', color: MUTED, fontStyle: 'italic' }}>{empty}</p>}
    </div>
  );
}

const Sub = ({ children }: { children: React.ReactNode }) => <span style={{ display: 'block', fontSize: '7pt', color: MUTED }}>{children}</span>;

function entryRows(list: DiaryEntry[], kind: 'rabies' | 'vaccine' | 'care') {
  return list.map((e) => {
    const who = <span style={{ fontSize: '7.5pt' }}>{dash(e.by)}</span>;
    if (kind === 'rabies') return [day(e.date), <b key="t">{e.detail ?? e.title}</b>, dash(e.batch), day(e.validUntil), who];
    if (kind === 'vaccine') return [day(e.date), <span key="t"><b>{e.title}</b>{e.detail && <Sub>{e.detail}</Sub>}</span>, dash(e.batch), day(e.validUntil), who];
    return [day(e.date), <span key="t"><b>{e.detail ?? e.title}</b>{e.detail && e.detail !== e.title && <Sub>{e.title}</Sub>}</span>, day(e.validUntil), who];
  });
}

function serologyRows(list: SerologyTestView[]) {
  return list.map((t) => [
    <span key="d">{day(t.sampleDate)}{t.reference && <Sub>Ref. {t.reference}</Sub>}</span>,
    dash(t.laboratory),
    <span key="r"><b>{t.resultValue != null ? `${t.resultValue} ${t.resultUnit}` : '—'}</b></span>,
    <span key="o" style={{ color: t.outcome === 'UNSATISFACTORY' ? '#b91c1c' : '#047857', fontWeight: 600 }}>{t.outcome ? SEROLOGY_OUTCOME_LABELS[t.outcome] : '—'}</span>,
    <span key="v">{t.validFrom ? day(t.validFrom) : t.validUntil ? '' : '—'}{t.validUntil && <Sub>until {day(t.validUntil)}</Sub>}</span>,
  ]);
}

interface PageDef {
  key: string;
  kind: 'front' | 'back' | 'sheet';
  title?: string;
  subtitle?: string;
  icon?: Icon;
  body?: React.ReactNode;
}

/** All the pages of one diary, in order — leaving out the sections the clinic switched off. */
function buildPages(ctx: Ctx): PageDef[] {
  const { diary, settings, style } = ctx;
  const P = diary.patient;
  const hidden = new Set<string>(settings.hiddenSections);
  const rule = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} style={{ height: '8mm', borderBottom: '0.25mm solid #d1d5db' }} />);
  const pages: PageDef[] = [{ key: 'cover', kind: 'front' }];

  pages.push({
    key: 'owner',
    kind: 'sheet',
    title: 'Owner',
    subtitle: 'The person responsible for the animal.',
    icon: UserRound,
    body: diary.owner ? (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '150mm' }}>
        <Fields>
          <Field label="Name" wide>{diary.owner.name}</Field>
          <Field label="Address" wide>{dash(diary.owner.address)}</Field>
          <Field label="Phone">{dash(diary.owner.phone)}</Field>
          <Field label="Email">{dash(diary.owner.email)}</Field>
          <Field label="Patient number">{P.patientNo}</Field>
          <Field label="Registered with the clinic">{day(P.registeredOn)}</Field>
          <Field label="Emergency contact" wide><div style={{ height: '6mm' }} /></Field>
        </Fields>
        {ctx.qrValue && (
          <div style={{ marginTop: 'auto', marginBottom: '4mm', display: 'flex', alignItems: 'center', gap: '4mm', border: `0.3mm solid ${tint(style.accent, 0.4)}`, borderRadius: '2mm', padding: '3mm 4mm', background: tint(style.accent, 0.04) }}>
            <Qr value={ctx.qrValue} color={style.accent} size="21mm" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '9.5pt', fontWeight: 700, color: style.accent }}>Always with you, online</div>
              <div style={{ fontSize: '7.8pt', color: MUTED, lineHeight: 1.45, marginTop: '0.8mm' }}>Scan the code to see {P.name}’s up-to-date diary on your phone — vaccinations, treatments and what is due next.</div>
            </div>
          </div>
        )}
      </div>
    ) : (
      <p style={{ fontSize: '9pt', color: MUTED }}>No owner is recorded for this animal.</p>
    ),
  });

  pages.push({
    key: 'description',
    kind: 'sheet',
    title: 'Description of the animal',
    subtitle: 'As recorded by the clinic.',
    icon: PawPrint,
    body: (
      <div>
        {settings.showPhoto && style.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={style.photoUrl} alt="" style={{ float: 'right', width: '30mm', height: '30mm', objectFit: 'cover', borderRadius: '3mm', marginLeft: '5mm', marginBottom: '3mm', border: `0.4mm solid ${tint(style.accent, 0.5)}` }} />
        )}
        <Fields>
          <Field label="Name">{P.name}</Field>
          <Field label="Species">{P.species}</Field>
          <Field label="Breed" wide>{dash(P.breed)}</Field>
          <Field label="Sex">{P.sex}</Field>
          <Field label="Date of birth">{P.dateOfBirth ? `${day(P.dateOfBirth)}${P.dobEstimated ? ' (estimated)' : ''}` : '—'}</Field>
          <Field label="Age">{dash(P.age)}</Field>
          <Field label="Weight">{P.weight ? `${P.weight}${P.weightDate ? ` · ${day(P.weightDate)}` : ''}` : '—'}</Field>
          <Field label="Colour">{dash(P.colour)}</Field>
          <Field label="Blood type">{dash(P.bloodType)}</Field>
          <Field label="Markings" wide>{dash(P.markings)}</Field>
        </Fields>
      </div>
    ),
  });

  if (!hidden.has('identification')) {
    pages.push({
      key: 'identification',
      kind: 'sheet',
      title: 'Identification',
      subtitle: 'Microchip, tattoo and tag numbers.',
      icon: Fingerprint,
      body: (
        <div>
          {diary.identifiers.length ? (
            <div style={{ display: 'grid', gap: '4.4mm' }}>
              {diary.identifiers.map((i, k) => (
                <div key={k} style={{ border: `0.3mm solid ${i.type === 'MICROCHIP' ? style.accent : '#d1d5db'}`, borderRadius: '2mm', padding: '3mm 4mm', background: i.type === 'MICROCHIP' ? tint(style.accent, 0.05) : undefined }}>
                  <Eyebrow>{i.typeLabel}</Eyebrow>
                  <div style={{ fontSize: '14pt', fontWeight: 700, letterSpacing: '0.12em', marginTop: '0.8mm', fontFamily: MONO }}>{i.value}</div>
                  {(i.issuedAt || i.notes) && <div style={{ fontSize: '7.5pt', color: MUTED, marginTop: '1mm' }}>{[i.issuedAt && `Recorded ${day(i.issuedAt)}`, i.notes].filter(Boolean).join(' · ')}</div>}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '9pt', color: MUTED, fontStyle: 'italic' }}>No microchip or other identification is recorded yet.</p>
          )}
          <div style={{ marginTop: '8mm' }}>
            <Eyebrow>Notes</Eyebrow>
            {rule(6)}
          </div>
        </div>
      ),
    });
  }

  const tablePages = (section: string, key: string, title: string, subtitle: string, icon: Icon, size: number, cols: { label: string; width: string }[], rows: React.ReactNode[][], empty: string) => {
    if (hidden.has(section)) return;
    chunk(rows, size).forEach((part, i, all) =>
      pages.push({ key: `${key}${i}`, kind: 'sheet', title: all.length > 1 ? `${title} (${i + 1}/${all.length})` : title, subtitle, icon, body: <Table columns={cols} rows={part} size={size} empty={i === 0 ? empty : ''} accent={style.accent} /> }),
    );
  };

  tablePages('rabies', 'rabies', 'Rabies vaccination', 'Rabies vaccinations given, with the batch and the date the next dose is due.', ShieldCheck, DIARY_ROWS_PER_PAGE.rabies,
    [{ label: 'Date', width: '19%' }, { label: 'Vaccine', width: '27%' }, { label: 'Batch', width: '18%' }, { label: 'Valid until', width: '19%' }, { label: 'Vet', width: '17%' }],
    entryRows(diary.rabies, 'rabies'), 'No rabies vaccination is recorded yet.');
  tablePages('serology', 'serology', 'Rabies serological test', 'Antibody (titre) tests — often needed before travelling.', FlaskConical, DIARY_ROWS_PER_PAGE.serology,
    [{ label: 'Sample', width: '20%' }, { label: 'Laboratory', width: '20%' }, { label: 'Result', width: '17%' }, { label: 'Outcome', width: '17%' }, { label: 'Valid', width: '26%' }],
    serologyRows(diary.serology), 'No antibody test is recorded yet.');
  tablePages('future', 'future', 'Future tests', 'Tests planned for later.', CalendarClock, DIARY_ROWS_PER_PAGE.future,
    [{ label: 'Planned for', width: '24%' }, { label: 'Test', width: '34%' }, { label: 'Notes', width: '42%' }],
    diary.futureTests.map((t) => [<b key="d">{day(t.plannedFor)}</b>, 'Rabies antibody test', dash(t.notes)]), 'No test is planned.');
  tablePages('vaccinations', 'vacc', 'Other vaccinations', 'Vaccinations other than rabies.', Syringe, DIARY_ROWS_PER_PAGE.vaccinations,
    [{ label: 'Date', width: '17%' }, { label: 'Vaccine', width: '31%' }, { label: 'Batch', width: '17%' }, { label: 'Next due', width: '19%' }, { label: 'Vet', width: '16%' }],
    entryRows(diary.vaccinations, 'vaccine'), 'No other vaccination is recorded yet.');
  tablePages('deworming', 'worm', 'Deworming', 'Worm treatments, with when the next one is due.', Pill, DIARY_ROWS_PER_PAGE.deworming,
    [{ label: 'Date', width: '20%' }, { label: 'Product', width: '40%' }, { label: 'Next due', width: '22%' }, { label: 'Given by', width: '18%' }],
    entryRows(diary.deworming, 'care'), 'No deworming is recorded yet.');
  tablePages('tickFlea', 'flea', 'Tick & flea treatment', 'Tick and flea prevention, with when the next one is due.', Bug, DIARY_ROWS_PER_PAGE.tickFlea,
    [{ label: 'Date', width: '20%' }, { label: 'Product', width: '40%' }, { label: 'Next due', width: '22%' }, { label: 'Given by', width: '18%' }],
    entryRows(diary.tickFlea, 'care'), 'No tick or flea treatment is recorded yet.');
  tablePages('treatments', 'treat', 'Treatments', 'Medicines given at the clinic.', Stethoscope, DIARY_ROWS_PER_PAGE.treatments,
    [{ label: 'Date', width: '18%' }, { label: 'Medicine', width: '32%' }, { label: 'Dose and route', width: '24%' }, { label: 'Batch', width: '14%' }, { label: 'Given by', width: '12%' }],
    diary.treatments.map((t) => [day(t.date), <b key="m">{t.title}</b>, dash(t.detail), dash(t.batch), <span key="b" style={{ fontSize: '7.5pt' }}>{dash(t.by)}</span>]), 'No treatment is recorded yet.');
  tablePages('procedures', 'proc', 'Procedures', 'Surgery and dental procedures.', Scissors, DIARY_ROWS_PER_PAGE.procedures,
    [{ label: 'Date', width: '19%' }, { label: 'Procedure', width: '41%' }, { label: 'Details', width: '22%' }, { label: 'By', width: '18%' }],
    diary.procedures.map((t) => [day(t.date), <b key="p">{t.title}</b>, dash(t.detail), <span key="b" style={{ fontSize: '7.5pt' }}>{dash(t.by)}</span>]), 'No procedure is recorded yet.');

  for (let i = 0; i < settings.notesPages; i++) {
    pages.push({ key: `notes${i}`, kind: 'sheet', title: 'Notes', subtitle: 'For the owner and vets to write on.', icon: PenLine, body: <div>{rule(19)}</div> });
  }
  pages.push({ key: 'back', kind: 'back' });
  return pages;
}

/** Contact lines of the clinic. */
const contactLines = (c: Diary['clinic']) => [c.address, [c.phone, c.email].filter(Boolean).join(' · '), c.website].filter(Boolean) as string[];

/** The clinic's logo in a round badge (or its initial when it has none). */
function Badge({ ctx, size, onColor }: { ctx: Ctx; size: string; onColor: boolean }) {
  const { style, diary } = ctx;
  const box: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', flexShrink: 0 };
  return style.logoUrl ? (
    <span style={{ ...box, background: onColor ? '#fff' : 'transparent', padding: onColor ? `calc(${size} * 0.14)` : 0, boxSizing: 'border-box' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={style.logoUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </span>
  ) : (
    <span style={{ ...box, background: onColor ? '#fff' : style.accent, color: onColor ? style.accent : '#fff', fontSize: '24pt', fontWeight: 700 }}>{diary.clinic.name.trim().charAt(0).toUpperCase()}</span>
  );
}

/** The pet's round photo, or a paw when there is none. */
function PetPhoto({ ctx, size, ring, shape = 'round', lift }: { ctx: Ctx; size: string; ring: string; shape?: 'round' | 'oval'; /** A white disc and a soft shadow, for a photo that overlaps a colour block. */ lift?: boolean }) {
  const { style, settings } = ctx;
  const h = shape === 'oval' ? `calc(${size} * 1.22)` : size;
  const common: React.CSSProperties = { width: size, height: h, borderRadius: '50%', border: `1mm solid ${ring}`, flexShrink: 0, boxSizing: 'border-box', boxShadow: lift ? '0 0.8mm 2.4mm rgba(0,0,0,0.28)' : undefined };
  return settings.showPhoto && style.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={style.photoUrl} alt="" style={{ ...common, objectFit: 'cover' }} />
  ) : (
    <span style={{ ...common, display: 'flex', alignItems: 'center', justifyContent: 'center', color: lift ? style.accent : ring, background: lift ? '#fff' : undefined }}>
      <PawPrint style={{ width: '45%', height: '45%', opacity: 0.9 }} />
    </span>
  );
}

function FrontCover({ ctx }: { ctx: Ctx }) {
  const { diary, settings, style } = ctx;
  const P = diary.patient;
  const a = style.accent;
  const lines = contactLines(diary.clinic);
  const breed = [P.species, P.breed].filter(Boolean).join(' · ');

  if (settings.theme === 'MODERN') {
    return (
      <section className="diary-page relative flex flex-col overflow-hidden" style={pageBox({ background: '#fff' })}>
        <div style={{ background: a, color: '#fff', height: '82mm', padding: '12mm 12mm 0', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4mm' }}>
            <Badge ctx={ctx} size="16mm" onColor />
            <span style={{ fontSize: '11pt', fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1.2 }}>{diary.clinic.name}</span>
          </div>
          <div style={{ position: 'absolute', left: '12mm', right: '12mm', bottom: '13mm' }}>
            <div style={{ fontSize: '24pt', fontWeight: 800, lineHeight: 1.05 }}>{settings.title}</div>
            {settings.tagline && <div style={{ fontSize: '9.5pt', opacity: 0.9, marginTop: '2mm' }}>{settings.tagline}</div>}
          </div>
          <div style={{ position: 'absolute', right: '12mm', bottom: '-23mm', zIndex: 2 }}>
            <PetPhoto ctx={ctx} size="46mm" ring="#fff" lift />
          </div>
        </div>
        <div style={{ padding: '14mm 12mm 0', flex: 1 }}>
          <div style={{ fontSize: '30pt', fontWeight: 800, lineHeight: 1.05, color: a, overflowWrap: 'anywhere', maxWidth: '88mm' }}>{P.name}</div>
          <div style={{ fontSize: '11pt', marginTop: '2mm', color: INK }}>{breed}</div>
          <div style={{ width: '16mm', height: '1mm', background: a, margin: '5mm 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm 6mm', maxWidth: '100mm' }}>
            <div><Eyebrow>Patient number</Eyebrow><div style={{ fontFamily: MONO, fontWeight: 700, fontSize: '10pt', marginTop: '0.6mm' }}>{P.patientNo}</div></div>
            {P.dateOfBirth && <div><Eyebrow>Born</Eyebrow><div style={{ fontWeight: 700, fontSize: '10pt', marginTop: '0.6mm' }}>{day(P.dateOfBirth)}</div></div>}
          </div>
        </div>
        <div style={{ borderTop: `0.4mm solid ${tint(a, 0.4)}`, margin: '0 12mm', padding: '4mm 0 10mm', fontSize: '7.6pt', color: MUTED, lineHeight: 1.55 }}>
          {lines.map((l) => <div key={l}>{l}</div>)}
        </div>
        <div style={{ height: '5mm', background: a }} />
      </section>
    );
  }

  if (settings.theme === 'ELEGANT') {
    return (
      <section className="diary-page relative flex flex-col overflow-hidden" style={pageBox({ background: '#fffdf8', fontFamily: SERIF })}>
        <div style={{ position: 'absolute', inset: '5mm', border: `0.7mm solid ${a}`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: '7.6mm', border: `0.25mm solid ${tint(a, 0.7)}`, pointerEvents: 'none' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '17mm 16mm 6mm' }}>
          <Badge ctx={ctx} size="20mm" onColor={false} />
          <div style={{ fontSize: '10pt', letterSpacing: '0.28em', textTransform: 'uppercase', color: a, marginTop: '3mm', fontWeight: 700 }}>{diary.clinic.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', margin: '5mm 0 4mm' }}>
            <span style={{ width: '24mm', height: '0.25mm', background: tint(a, 0.6) }} />
            <span style={{ width: '1.8mm', height: '1.8mm', background: a, transform: 'rotate(45deg)' }} />
            <span style={{ width: '24mm', height: '0.25mm', background: tint(a, 0.6) }} />
          </div>
          <div style={{ fontSize: '21pt', fontWeight: 700, color: a, lineHeight: 1.1, letterSpacing: '0.03em' }}>{settings.title}</div>
          {settings.tagline && <div style={{ fontStyle: 'italic', fontSize: '9.5pt', color: MUTED, marginTop: '2mm' }}>{settings.tagline}</div>}
          <div style={{ marginTop: '7mm' }}>
            <PetPhoto ctx={ctx} size="40mm" ring={a} shape="oval" />
          </div>
          <div style={{ fontSize: '26pt', fontWeight: 700, lineHeight: 1.05, marginTop: '5mm', overflowWrap: 'anywhere', color: INK }}>{P.name}</div>
          <div style={{ fontStyle: 'italic', fontSize: '10.5pt', color: MUTED, marginTop: '1mm' }}>{breed}</div>
          <div style={{ fontFamily: MONO, fontSize: '8pt', letterSpacing: '0.12em', color: MUTED, marginTop: '2mm' }}>{P.patientNo}</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0 16mm 14mm', fontSize: '7.6pt', color: MUTED, lineHeight: 1.55 }}>{lines.map((l) => <div key={l}>{l}</div>)}</div>
      </section>
    );
  }

  // CLASSIC: a full colour cover.
  return (
    <section className="diary-page relative flex flex-col overflow-hidden" style={pageBox({ background: a, color: '#fff' })}>
      <div style={{ position: 'absolute', right: '-30mm', top: '-26mm', width: '96mm', height: '96mm', borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
      <div style={{ position: 'absolute', left: '-34mm', bottom: '10mm', width: '84mm', height: '84mm', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ position: 'absolute', inset: '6mm', border: '0.5mm solid rgba(255,255,255,0.55)', borderRadius: '3mm', pointerEvents: 'none' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '14mm 14mm 6mm', gap: '3mm', position: 'relative' }}>
        <Badge ctx={ctx} size="28mm" onColor />
        <div style={{ fontSize: '12pt', fontWeight: 700, letterSpacing: '0.04em' }}>{diary.clinic.name}</div>
        <div style={{ width: '24mm', height: '0.5mm', background: 'rgba(255,255,255,0.7)', margin: '3mm 0 1mm' }} />
        <p style={{ fontSize: '9.5pt', letterSpacing: '0.3em', textTransform: 'uppercase', opacity: 0.9, fontWeight: 600 }}>{settings.title}</p>
        {settings.tagline && <p style={{ fontSize: '8.5pt', opacity: 0.8, fontStyle: 'italic' }}>{settings.tagline}</p>}
        <div style={{ marginTop: '2mm' }}>
          <PetPhoto ctx={ctx} size="42mm" ring="#fff" />
        </div>
        <div style={{ fontSize: '28pt', fontWeight: 800, lineHeight: 1.05, marginTop: '2mm', overflowWrap: 'anywhere' }}>{P.name}</div>
        <div style={{ fontSize: '10.5pt', opacity: 0.92 }}>{breed}</div>
        <div style={{ fontSize: '8.5pt', opacity: 0.8, fontFamily: MONO, letterSpacing: '0.1em' }}>{P.patientNo}</div>
      </div>
      <div style={{ position: 'relative', background: 'rgba(0,0,0,0.2)', textAlign: 'center', padding: '5mm 14mm 9mm', fontSize: '7.8pt', lineHeight: 1.55 }}>{lines.map((l) => <div key={l}>{l}</div>)}</div>
    </section>
  );
}

function BackCover({ ctx }: { ctx: Ctx }) {
  const { diary, settings, style, qrValue } = ctx;
  const a = style.accent;
  const theme = settings.theme;
  const onColor = theme === 'CLASSIC';
  const fg = onColor ? '#fff' : INK;
  const sub = onColor ? 'rgba(255,255,255,0.82)' : MUTED;
  const lines = contactLines(diary.clinic);
  return (
    <section className="diary-page relative flex flex-col overflow-hidden" style={pageBox({ background: onColor ? a : theme === 'ELEGANT' ? '#fffdf8' : '#fff', color: fg, fontFamily: theme === 'ELEGANT' ? SERIF : undefined })}>
      {theme === 'CLASSIC' && <div style={{ position: 'absolute', inset: '6mm', border: '0.5mm solid rgba(255,255,255,0.55)', borderRadius: '3mm', pointerEvents: 'none' }} />}
      {theme === 'ELEGANT' && (
        <>
          <div style={{ position: 'absolute', inset: '5mm', border: `0.7mm solid ${a}`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: '7.6mm', border: `0.25mm solid ${tint(a, 0.7)}`, pointerEvents: 'none' }} />
        </>
      )}
      {theme === 'MODERN' && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '5mm', background: a }} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '16mm 14mm 10mm', gap: '3mm', position: 'relative' }}>
        <Badge ctx={ctx} size="22mm" onColor={onColor || theme === 'MODERN'} />
        <div style={{ fontSize: '11.5pt', fontWeight: 700, letterSpacing: '0.04em', color: onColor ? '#fff' : theme === 'ELEGANT' ? a : INK }}>{diary.clinic.name}</div>
        <div style={{ width: '24mm', height: '0.5mm', background: onColor ? 'rgba(255,255,255,0.7)' : a, margin: '2mm 0' }} />
        <p style={{ fontSize: '12pt', fontWeight: 700 }}>{settings.backTitle}</p>
        {settings.backMessage && <p style={{ fontSize: '8.5pt', color: sub, maxWidth: '98mm', lineHeight: 1.5 }}>{settings.backMessage.replace(/your pet’s/g, `${diary.patient.name}’s`)}</p>}
        {qrValue && (
          <div style={{ marginTop: '3mm', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.6mm' }}>
            <span style={{ display: 'block', background: '#fff', padding: '2.6mm', borderRadius: '2mm', border: onColor ? undefined : `0.3mm solid ${tint(a, 0.5)}` }}>
              <Qr value={qrValue} color={onColor ? '#111827' : a} size="30mm" />
            </span>
            <span style={{ fontSize: '7.6pt', color: sub }}>Scan to open {diary.patient.name}’s diary online</span>
          </div>
        )}
        {settings.emergencyNote && (
          <div style={{ marginTop: '2mm', border: `0.3mm solid ${onColor ? 'rgba(255,255,255,0.6)' : a}`, borderRadius: '2mm', padding: '2mm 4mm', fontSize: '8.5pt', fontWeight: 600, maxWidth: '104mm' }}>{settings.emergencyNote}</div>
        )}
        <div style={{ marginTop: '3mm', display: 'grid', gap: '1mm', fontSize: '8.4pt', color: onColor ? '#fff' : INK }}>
          {diary.clinic.branch && <b>{diary.clinic.branch}</b>}
          {lines.map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>
      <p style={{ textAlign: 'center', fontSize: '6.8pt', color: sub, padding: '0 14mm 11mm', position: 'relative' }}>Printed {day(diary.generatedOn)} from the clinic’s records.</p>
    </section>
  );
}

function renderPage(p: PageDef, i: number, total: number, ctx: Ctx) {
  if (p.kind === 'front') return <FrontCover key={p.key} ctx={ctx} />;
  if (p.kind === 'back') return <BackCover key={p.key} ctx={ctx} />;
  return (
    <Sheet key={p.key} title={p.title!} subtitle={p.subtitle} icon={p.icon!} n={i + 1} total={total} ctx={ctx}>
      {p.body}
    </Sheet>
  );
}

function useCtx(b: DiaryBooklet, given: DiaryStyle): Ctx {
  return { diary: b.diary, settings: b.settings, qrValue: b.qrValue, style: { ...given, accent: readableAccent(b.settings.accentColor ?? given.accent) } };
}

/** The whole booklet at true size, page after page — what is printed. */
export function DiaryPages({ booklet, style }: { booklet: DiaryBooklet; style: DiaryStyle }) {
  const ctx = useCtx(booklet, style);
  const pages = buildPages(ctx);
  return <>{pages.map((p, i) => renderPage(p, i, pages.length, ctx))}</>;
}

/** The pages for the screen, each scaled to fit the width given, two to a row when there is room. */
export function DiaryPreview({ booklet, style, limit, maxCell = 440 }: { booklet: DiaryBooklet; style: DiaryStyle; /** Show only the first pages (the design preview in Settings). */ limit?: number; maxCell?: number }) {
  const ctx = useCtx(booklet, style);
  const all = buildPages(ctx);
  // The back cover is shown last even when the preview is cut short.
  const pages = limit && limit < all.length ? [...all.slice(0, limit - 1), all[all.length - 1]] : all;
  const [width, setWidth] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  const cols = width >= maxCell * 2 + 40 ? 2 : 1;
  const cell = Math.min(maxCell, Math.floor((width - (cols - 1) * 24) / cols));
  const scale = cell / (DIARY_PAGE.w * MM_TO_PX);
  return (
    <div ref={setNode} className="w-full min-w-0">
      {width > 0 && (
        <div className="grid justify-center gap-6" style={{ gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}>
          {pages.map((p) => {
            const i = all.indexOf(p);
            return (
              <div key={p.key} className={cn('overflow-hidden rounded-md bg-white shadow-md ring-1 ring-black/10')} style={{ width: cell, height: DIARY_PAGE.h * MM_TO_PX * scale }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${DIARY_PAGE.w}mm` }}>{renderPage(p, i, all.length, ctx)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Puts the print copy straight into <body>, so printing leaves out the rest of the app, one A5 page per sheet. */
export function DiaryPrintRoot({ booklet, style }: { booklet: DiaryBooklet; style: DiaryStyle }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'diary-print-root';
    el.style.display = 'none';
    document.body.appendChild(el);
    setNode(el);
    return () => el.remove();
  }, []);
  return (
    <>
      <style>{`@media print { @page { size: ${DIARY_PAGE.w}mm ${DIARY_PAGE.h}mm; margin: 0 } html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #fff !important } body > *:not(.diary-print-root) { display: none !important } .diary-print-root { display: block !important } .diary-print-root .diary-page:last-child { break-after: auto !important } }`}</style>
      {node ? createPortal(<DiaryPages booklet={booklet} style={style} />, node) : null}
    </>
  );
}
