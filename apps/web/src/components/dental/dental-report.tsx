'use client';
import { CALCULUS_INDEX, DENTITION_LABELS, GINGIVAL_INDEX, OCCLUSION_LABELS, PERIODONTAL_STAGES, dentalFinding, enumLabel, teethFor, toothInfo, type Occlusion } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { LetterFooter, Letterhead } from '../documents/letterhead';
import { Odontogram } from './odontogram';
import { fmtDate, fmtDateTime } from '@/lib/format';
import type { DentalChart } from '@/lib/types';

/** Printable dental report: the chart, tooth findings, procedures, home care and recheck, signed by the vet. */
export function DentalReport({ chart: c, clinic }: { chart: DentalChart; clinic: ClinicHeader | null }) {
  const stage = c.periodontalStage ?? c.worstToothStage;
  const findings = c.teeth.filter((t) => t.state !== 'PRESENT' || t.findings.length || t.pdStage || t.mobility || t.furcation || t.calculus || t.gingivitis || t.notes);
  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-[10.5pt] text-black [--card:0_0%_100%] [--foreground:0_0%_0%] [--muted:0_0%_94%] [--muted-foreground:0_0%_40%]">
      <Letterhead clinic={clinic} title={<p className="text-center text-xl font-bold tracking-wide">DENTAL CHART</p>} />
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline font-semibold">Animal: </dt><dd className="inline">{c.patient.name} ({c.patient.patientNo})</dd></div>
        <div><dt className="inline font-semibold">Species / breed: </dt><dd className="inline">{c.patient.species.name}{c.patient.breed?.name || c.patient.breedText ? ` · ${c.patient.breed?.name ?? c.patient.breedText}` : ''}</dd></div>
        <div><dt className="inline font-semibold">Owner: </dt><dd className="inline">{c.client.displayName}</dd></div>
        <div><dt className="inline font-semibold">Chart: </dt><dd className="inline">{c.chartNo} · {DENTITION_LABELS[c.dentition]} · {fmtDateTime(c.examinedAt)}</dd></div>
        <div><dt className="inline font-semibold">Vet: </dt><dd className="inline">{c.clinicianName}{c.anaesthetised ? ' · under general anaesthetic' : ''}</dd></div>
        <div><dt className="inline font-semibold">Status: </dt><dd className="inline">{c.status === 'SIGNED' ? `Signed by ${c.signedByName} ${fmtDate(c.signedAt)}` : 'Draft — not signed'}</dd></div>
      </dl>

      <div className="mb-2 break-inside-avoid rounded border border-gray-300 p-2">
        <Odontogram teeth={teethFor(c.dentition)} findings={c.teeth} procedures={c.procedures} readOnly className="overflow-visible" />
        {c.showDeciduous && <Odontogram teeth={teethFor(c.dentition, true)} findings={c.teeth} procedures={c.procedures} readOnly className="mt-2 overflow-visible" />}
      </div>
      <p className="mb-4 text-xs text-gray-600">Viewed facing the animal: its right side is on the left. Teeth are numbered by the modified Triadan system. ✕ = extracted.</p>

      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <p><b>Periodontal stage:</b> {stage != null ? `${PERIODONTAL_STAGES[stage].label} — ${PERIODONTAL_STAGES[stage].hint}` : 'Not recorded'}</p>
        <p><b>Bite:</b> {c.occlusion ? OCCLUSION_LABELS[c.occlusion as Occlusion] : 'Not recorded'}</p>
        <p><b>Tartar:</b> {c.calculusIndex != null ? `${CALCULUS_INDEX[c.calculusIndex].label} — ${CALCULUS_INDEX[c.calculusIndex].hint}` : 'Not recorded'}</p>
        <p><b>Gums:</b> {c.gingivalIndex != null ? `${GINGIVAL_INDEX[c.gingivalIndex].label} — ${GINGIVAL_INDEX[c.gingivalIndex].hint}` : 'Not recorded'}</p>
      </div>
      {c.oralFindings && <p className="mb-4 whitespace-pre-wrap text-sm"><b>Mouth, gums and soft tissue:</b> {c.oralFindings}</p>}

      {!!findings.length && (
        <>
          <h2 className="mb-1 text-sm font-bold uppercase">Tooth findings</h2>
          <table className="mb-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-black text-left [&>th]:px-2 [&>th]:py-1 [&>th:first-child]:pl-0"><th>Tooth</th><th>Findings</th><th>Scores</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {findings.map((t) => (
                <tr key={t.tooth} className="break-inside-avoid border-b border-gray-300 align-top [&>td]:px-2 [&>td]:py-1 [&>td:first-child]:pl-0">
                  <td className="whitespace-nowrap">{toothInfo(c.dentition, t.tooth)?.name ?? t.tooth}</td>
                  <td>{[t.state !== 'PRESENT' ? enumLabel(t.state) : '', ...t.findings.map((f) => (f === 'TR' && t.trStage ? `Tooth resorption stage ${t.trStage}` : (dentalFinding(f)?.label ?? f)))].filter(Boolean).join('; ') || '—'}</td>
                  <td className="whitespace-nowrap">{[t.pdStage != null && `PD${t.pdStage}`, t.mobility != null && `M${t.mobility}`, t.furcation != null && `F${t.furcation}`, t.calculus != null && `CI${t.calculus}`, t.gingivitis != null && `GI${t.gingivitis}`, t.probingMm != null && `${t.probingMm} mm pocket`, t.recessionMm != null && `${t.recessionMm} mm recession`].filter(Boolean).join(', ') || '—'}</td>
                  <td>{t.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2 className="mb-1 text-sm font-bold uppercase">Treatment done</h2>
      {c.procedures.length ? (
        <ul className="mb-4 list-disc pl-5 text-sm">
          {c.procedures.map((p) => (
            <li key={p.id}>{p.label}{p.tooth ? ` — ${toothInfo(c.dentition, p.tooth)?.name ?? p.tooth}` : ''}{p.notes ? ` (${p.notes})` : ''}</li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm">No treatment at this visit.</p>
      )}

      {c.homeCare && <p className="mb-2 whitespace-pre-wrap text-sm"><b>Home care:</b> {c.homeCare}</p>}
      {c.recheckDate && <p className="mb-2 text-sm"><b>Recheck:</b> {fmtDate(c.recheckDate)}</p>}
      {!!c.addenda.length && (
        <div className="mb-2 text-sm">
          <b>Addenda:</b>
          <ul className="list-disc pl-5">{c.addenda.map((a) => <li key={a.id}>{a.text} — {a.authorName}, {fmtDate(a.createdAt)}</li>)}</ul>
        </div>
      )}
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
        <p className="border-t border-black pt-1">Veterinarian: {c.signedByName ?? c.clinicianName}</p>
        <p className="border-t border-black pt-1">Clinic stamp · printed {fmtDate(new Date())}</p>
      </div>
      <LetterFooter />
    </article>
  );
}
