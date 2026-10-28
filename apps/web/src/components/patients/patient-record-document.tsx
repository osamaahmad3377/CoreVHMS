'use client';
import { enumLabel } from '@vcms/shared';
import { Fragment } from 'react';
import type { ClinicHeader } from '../billing/invoice-document';
import { LetterFooter, Letterhead } from '../documents/letterhead';
import { fmtAge, fmtDate, fmtDateTime, fmtMoney, fmtWeight } from '@/lib/format';
import type { PatientDetail } from '@/lib/types';

type Row = Record<string, any>;

export interface PatientRecordData {
  generatedAt: string;
  generatedBy: string | null;
  clinic: { name: string };
  patient: PatientDetail;
  sections: { name: string; title: string; data: any }[];
  omitted: string[];
}

const th = 'border-b border-gray-400 px-1.5 py-1 text-left font-semibold';
const td = 'border-b border-gray-200 px-1.5 py-1 align-top';

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b-2 border-gray-800 pb-0.5 text-[11pt] font-bold uppercase tracking-wide">
        {title}
        {count !== undefined && <span className="ml-2 text-[9pt] font-normal normal-case text-gray-600">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

function None({ children = 'Nothing recorded.' }: { children?: React.ReactNode }) {
  return <p className="text-sm text-gray-600">{children}</p>;
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt className="inline font-semibold">{k}: </dt>
          <dd className="inline">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return null;
  return (
    <table className="mb-2 w-full text-[9.5pt]">
      <thead>
        <tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">{r.map((c, j) => <td key={j} className={td}>{c ?? '—'}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** A record card: a heading line and its content, kept together on a printed page where possible. */
function Entry({ title, meta, children }: { title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-3 break-inside-avoid rounded border border-gray-300 p-2.5 text-sm">
      <p className="font-semibold">{title}</p>
      {meta && <p className="text-[9.5pt] text-gray-600">{meta}</p>}
      {children && <div className="mt-1.5 grid gap-1.5">{children}</div>}
    </div>
  );
}

const NOTE_SECTIONS: [string, string][] = [
  ['presentingComplaint', 'Presenting complaint'], ['history', 'Past history'], ['subjective', 'History from the client'], ['objective', 'Examination findings'],
  ['assessment', 'Assessment'], ['plan', 'Plan'], ['followUpInstructions', 'Instructions for the client'],
];

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const label = (s: string) => enumLabel(s);

/* ── Section renderers ─────────────────────────────────────────────────────────────────────────── */

function Consultations({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No consultations.</None>;
  return (
    <>
      {rows.map((e) => {
        const v = e.vitals?.[e.vitals.length - 1];
        const notes = (e.notes ?? []).filter((n: Row) => n.status === 'SIGNED');
        const earlier = (e.notes ?? []).filter((n: Row) => n.status === 'SUPERSEDED').length;
        return (
          <Entry key={e.id} title={`${e.encounterNo} — ${fmtDateTime(e.startedAt)} — ${label(e.type)}${e.chiefComplaint ? `: ${e.chiefComplaint}` : ''}`} meta={`${e.clinician ?? 'No vet recorded'} · ${e.status === 'COMPLETED' ? 'Finished' : label(e.status)}`}>
            {v && (
              <p className="text-[9.5pt]">
                <span className="font-semibold">Vital signs ({fmtDateTime(v.recordedAt)}): </span>
                {[v.temperatureC != null && `Temp ${v.temperatureC} °C`, v.heartRate != null && `Heart rate ${v.heartRate}`, v.respiratoryRate != null && `Breathing ${v.respiratoryRate}`, v.weightKg != null && `Weight ${fmtWeight(Number(v.weightKg))}`, v.mucousMembranes && `Gums ${v.mucousMembranes}`, v.painScore != null && `Pain ${v.painScore}/10`].filter(Boolean).join(' · ') || '—'}
              </p>
            )}
            {e.diagnoses?.length > 0 && (
              <p className="text-[9.5pt]">
                <span className="font-semibold">Diagnosis: </span>
                {e.diagnoses.map((d: Row) => `${d.term} (${label(d.type)})`).join('; ')}
              </p>
            )}
            {notes.map((n: Row) => (
              <dl key={n.id} className="grid gap-1 text-[9.5pt]">
                {NOTE_SECTIONS.filter(([k]) => n[k]).map(([k, t]) => (
                  <div key={k}>
                    <dt className="font-semibold text-gray-600">{t}</dt>
                    <dd className="whitespace-pre-wrap">{n[k]}</dd>
                  </div>
                ))}
                {Array.isArray(n.examFindings) && n.examFindings.some((f: Row) => f.status !== 'NOT_EXAMINED') && (
                  <div>
                    <dt className="font-semibold text-gray-600">Physical examination</dt>
                    <dd>{n.examFindings.filter((f: Row) => f.status !== 'NOT_EXAMINED').map((f: Row) => `${f.status === 'ABNORMAL' ? '✗' : '✓'} ${f.system}${f.notes ? ` (${f.notes})` : ''}`).join('; ')}</dd>
                  </div>
                )}
                <p className="text-xs text-gray-600">Signed by {n.signedByName} · {fmtDateTime(n.signedAt)}{n.version > 1 ? ` · version ${n.version}` : ''}{earlier ? ` · ${earlier} earlier version${earlier > 1 ? 's' : ''} kept` : ''}</p>
              </dl>
            ))}
            {!notes.length && <p className="text-[9.5pt] text-gray-600">No signed note for this visit.</p>}
            {e.tasks?.length > 0 && <p className="text-[9.5pt]"><span className="font-semibold">Follow-up tasks: </span>{e.tasks.map((t: Row) => `${t.title} (${fmtDate(t.dueAt)}, ${label(t.status)})`).join('; ')}</p>}
          </Entry>
        );
      })}
    </>
  );
}

function Prescriptions({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No prescriptions.</None>;
  return (
    <>
      {rows.map((p) => (
        <Entry key={p.id} title={`${p.prescriptionNo} — ${fmtDate(p.createdAt)} — ${label(p.status)}`} meta={[p.authorizedByName && `Authorised by ${p.authorizedByName}`, p.weightKg && `weight ${fmtWeight(Number(p.weightKg))}`, p.validUntil && `valid until ${fmtDate(p.validUntil)}`].filter(Boolean).join(' · ')}>
          <MiniTable
            head={['Medicine', 'How to give', 'For', 'Qty', 'Supplied']}
            rows={(p.items ?? []).map((i: Row) => [
              i.product?.name ?? `${i.outsideName} (bought outside)`,
              `${i.doseValue} ${i.doseUnit} ${label(i.route).toLowerCase()}, ${i.frequencyText}${i.instructions ? ` — ${i.instructions}` : ''}`,
              i.durationDays ? `${i.durationDays} days` : '—',
              i.quantity,
              (i.dispensations ?? []).map((d: Row) => `${d.quantity} on ${fmtDate(d.dispensedAt)}${d.batchNumber ? ` (batch ${d.batchNumber})` : ''}`).join('; ') || (i.productId ? 'Not yet' : 'Outside'),
            ])}
          />
          {p.notes && <p className="text-[9.5pt]">{p.notes}</p>}
        </Entry>
      ))}
    </>
  );
}

function Administrations({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No medicines given in the clinic.</None>;
  return (
    <MiniTable
      head={['When', 'Medicine', 'Dose', 'How given', 'Given by', 'Batch']}
      rows={rows.map((a) => [fmtDateTime(a.administeredAt), a.product?.name, `${a.dose} ${a.doseUnit}`, `${label(a.route)}${a.site ? ` (${a.site})` : ''}`, a.status === 'NOT_GIVEN' ? `Not given — ${a.reasonNotGiven ?? ''}` : a.administeredByName, a.batchNumber])}
    />
  );
}

function Diagnostics({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No tests.</None>;
  return (
    <>
      {rows.map((o) => (
        <Entry key={o.id} title={`${o.orderNo} — ${fmtDate(o.createdAt)} — ${label(o.status)}`} meta={`Ordered by ${o.orderedByName}${o.releasedAt ? ` · released ${fmtDateTime(o.releasedAt)}` : ''}`}>
          {(o.items ?? []).map((i: Row) => (
            <div key={i.id}>
              <p className="text-[9.5pt] font-semibold">{i.test?.name}</p>
              <MiniTable
                head={['Result', 'Value', 'Normal range', 'Flag']}
                rows={(i.results ?? []).filter((r: Row) => r.status !== 'SUPERSEDED').map((r: Row) => [r.analyte?.name, `${r.valueNumeric ?? r.valueText ?? '—'}${r.unit ? ` ${r.unit}` : ''}`, r.refLow != null || r.refHigh != null ? `${r.refLow ?? ''}–${r.refHigh ?? ''}` : '—', r.flag ? label(r.flag) : ''])}
              />
              {i.imagingReport && (
                <p className="text-[9.5pt]">
                  <span className="font-semibold">{i.imagingReport.modality} report: </span>
                  {i.imagingReport.findings} <span className="font-semibold">Conclusion: </span>{i.imagingReport.conclusion}
                </p>
              )}
            </div>
          ))}
        </Entry>
      ))}
    </>
  );
}

function Preventive({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No vaccinations or preventive care recorded.</None>;
  return (
    <MiniTable
      head={['Due', 'What', 'Status', 'Done', 'Product / batch']}
      rows={rows.map((c) => [fmtDate(c.dueDate), `${label(c.kind)}: ${c.title}`, label(c.status), c.completedAt ? `${fmtDate(c.completedAt)}${c.completedByName ? ` by ${c.completedByName}` : ''}` : '—', [c.productName, c.batchNumber && `batch ${c.batchNumber}`].filter(Boolean).join(', ') || '—'])}
    />
  );
}

function Appointments({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No appointments.</None>;
  return <MiniTable head={['When', 'Appointment', 'Type', 'Vet', 'Reason', 'Status']} rows={rows.map((a) => [fmtDateTime(a.startsAt), a.appointmentNo, a.appointmentType, a.clinician, a.reason ?? a.cancelReason, label(a.status)])} />;
}

function Admissions({ rows }: { rows: Row[] }) {
  if (!rows.length) return <None>No hospital stays.</None>;
  return (
    <>
      {rows.map((a) => (
        <Entry key={a.id} title={`${a.admissionNo} — admitted ${fmtDateTime(a.admittedAt)}${a.dischargedAt ? `, discharged ${fmtDateTime(a.dischargedAt)}` : ''}`} meta={`${label(a.status)}${a.outcome ? ` · ${label(a.outcome)}` : ''}`}>
          <p className="text-[9.5pt]"><span className="font-semibold">Reason: </span>{a.reason}{a.diagnosis ? ` — ${a.diagnosis}` : ''}</p>
          {a.dischargeSummary && <p className="whitespace-pre-wrap text-[9.5pt]"><span className="font-semibold">Discharge summary: </span>{a.dischargeSummary}</p>}
          {a.homeCareInstructions && <p className="whitespace-pre-wrap text-[9.5pt]"><span className="font-semibold">Care at home: </span>{a.homeCareInstructions}</p>}
          <MiniTable head={['Treatment ordered', 'How', 'Ordered by']} rows={(a.orders ?? []).map((o: Row) => [o.description, [o.route && label(o.route), o.intervalHours && `every ${o.intervalHours} h`].filter(Boolean).join(' · '), o.orderedByName])} />
          {(a.notes ?? []).map((n: Row) => <p key={n.id} className="text-[9.5pt]"><span className="text-gray-600">{fmtDateTime(n.createdAt)} · {n.authorName}: </span>{n.text}</p>)}
        </Entry>
      ))}
    </>
  );
}

function Billing({ data, currency }: { data: Row; currency: string }) {
  const invoices: Row[] = data?.invoices ?? [];
  const estimates: Row[] = data?.estimates ?? [];
  if (!invoices.length && !estimates.length) return <None>No invoices for this patient.</None>;
  return (
    <>
      {invoices.map((i) => (
        <Entry key={i.id} title={`${i.invoiceNo} — ${fmtDate(i.issuedAt ?? i.createdAt)} — ${label(i.status)}`} meta={`Total ${fmtMoney(i.totalMinor, currency)} · paid ${fmtMoney(i.paidMinor ?? 0, currency)}${i.balanceMinor ? ` · balance ${fmtMoney(i.balanceMinor, currency)}` : ''}`}>
          <MiniTable head={['Item', 'Qty', 'Amount']} rows={(i.lines ?? []).map((l: Row) => [l.description, l.quantity, fmtMoney(l.grossMinor, currency)])} />
        </Entry>
      ))}
      {estimates.length > 0 && <p className="text-[9.5pt]"><span className="font-semibold">Estimates: </span>{estimates.map((e) => `${fmtDate(e.createdAt)} (${label(e.status)})`).join('; ')}</p>}
    </>
  );
}

/** Any other section: its records as labelled cards, with dates, yes/no and codes made readable. */
const SKIP = /(^id$|Id$|^organization|hash|Hash|storageKey|sha256|^version$)/;
function readable(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return fmtDateTime(v);
  if (typeof v === 'string' && /^[A-Z0-9_]{3,}$/.test(v)) return label(v);
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return null;
}
const humanise = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function Generic({ data }: { data: any }) {
  if (Array.isArray(data)) {
    if (!data.length) return <None />;
    return (
      <>
        {data.map((r, i) => (
          <Entry key={r.id ?? i} title={r.title ?? r.term ?? r.fileName ?? r.stayNo ?? r.groomingNo ?? r.claimNo ?? r.referralNo ?? `Record ${i + 1}`}>
            <Facts items={Object.entries(r).filter(([k]) => !SKIP.test(k) && !['title', 'term', 'fileName'].includes(k)).map(([k, v]) => [humanise(k), readable(v)] as [string, React.ReactNode])} />
          </Entry>
        ))}
      </>
    );
  }
  if (data && typeof data === 'object') {
    return (
      <>
        {Object.entries(data).map(([k, v]) => (
          <Fragment key={k}>
            <h3 className="mb-1 mt-2 text-[10pt] font-semibold">{humanise(k)}</h3>
            <Generic data={v} />
          </Fragment>
        ))}
      </>
    );
  }
  return <None />;
}

/* ── The document ──────────────────────────────────────────────────────────────────────────────── */

/** Everything the clinic holds about one patient, laid out for reading on screen, printing or saving as PDF. */
export function PatientRecordDocument({ record, clinic, currency }: { record: PatientRecordData; clinic: ClinicHeader | null; currency: string }) {
  const p = record.patient;
  const breed = p.breed?.name ?? p.breedText;
  const count = (s: { data: any }) => (Array.isArray(s.data) ? s.data.length : undefined);
  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-[10.5pt] leading-snug text-black print:p-0">
      <Letterhead clinic={clinic} title={<p className="text-base font-bold">Complete patient record — {p.name} ({p.patientNo})</p>} aside={<p className="text-xs text-gray-600">Printed {fmtDateTime(record.generatedAt)}{record.generatedBy ? ` by ${record.generatedBy}` : ''}</p>} />

      <Section title="Patient">
        <Facts
          items={[
            ['Name', `${p.name} (${p.patientNo})`], ['Species', `${p.species.name}${breed ? `, ${breed}` : ''}`], ['Sex', label(p.sex)], ['Age', p.dateOfBirth ? fmtAge(p.dateOfBirth, p.dobEstimated, p.deceasedAt) : null],
            ['Born', p.dateOfBirth ? `${fmtDate(p.dateOfBirth)}${p.dobEstimated ? ' (estimated)' : ''}` : null], ['Colour', p.colour], ['Markings', p.markings], ['Blood type', p.bloodType],
            ['Latest weight', p.latestWeightKg ? fmtWeight(p.latestWeightKg) : null], ['Status', label(p.status)], ['Registered', fmtDate(p.createdAt)],
            ['Insurance', [p.insuranceProvider, p.insurancePolicyNumber].filter(Boolean).join(' — ')],
            ['Died', p.deceasedAt ? `${fmtDate(p.deceasedAt)}${p.causeOfDeath ? ` — ${p.causeOfDeath}` : ''}${p.euthanasia ? ' (euthanasia)' : ''}` : null],
          ]}
        />
        {p.notes && <p className="mt-1 whitespace-pre-wrap text-sm"><span className="font-semibold">Notes: </span>{p.notes}</p>}
      </Section>

      <Section title="Clients (owners)">
        <MiniTable
          head={['Client', 'Phone', 'Role', 'From', 'Until']}
          rows={(p.ownershipHistory ?? []).map((o) => [o.client.displayName, p.owner?.id === o.clientId ? p.owner.mobilePhone : p.coOwners.find((c) => c.id === o.clientId)?.mobilePhone ?? '—', o.isPrimary ? 'Main client' : 'Second client', fmtDate(o.startedAt), o.endedAt ? `${fmtDate(o.endedAt)}${o.endReason ? ` (${o.endReason})` : ''}` : 'Current'])}
        />
      </Section>

      {p.identifiers.length > 0 && (
        <Section title="Microchips and tags">
          <MiniTable head={['Type', 'Number', 'Issued', 'Notes']} rows={p.identifiers.map((i) => [label(i.type), i.value, i.issuedAt ? fmtDate(i.issuedAt) : '—', i.notes])} />
        </Section>
      )}

      <Section title="Medical alerts and allergies" count={p.alerts.length}>
        {p.alerts.length ? (
          <MiniTable head={['Alert', 'Details', 'Raised', 'Status']} rows={p.alerts.map((a) => [`${a.title}${a.substance ? ` (${a.substance}${a.reaction ? `: ${a.reaction}` : ''})` : ''}`, a.details, fmtDate(a.createdAt), a.isActive ? 'Active' : `Resolved ${fmtDate(a.resolvedAt)}`])} />
        ) : (
          <None>No alerts.</None>
        )}
      </Section>

      <Section title="Weight history" count={p.weights.length}>
        {p.weights.length ? <MiniTable head={['Date', 'Weight', 'Body condition', 'Notes']} rows={[...p.weights].reverse().map((w) => [fmtDate(w.measuredAt), fmtWeight(w.weightKg), w.bodyConditionScore ? `${w.bodyConditionScore}/${w.bcsScale}` : '—', w.notes])} /> : <None>No weights recorded.</None>}
      </Section>

      {record.sections.map((s) => (
        <Section key={s.name} title={s.title} count={count(s)}>
          {s.name === 'consultations' ? <Consultations rows={s.data} /> : s.name === 'prescriptions' ? <Prescriptions rows={s.data} /> : s.name === 'administrations' ? <Administrations rows={s.data} /> : s.name === 'diagnostics' ? <Diagnostics rows={s.data} /> : s.name === 'preventiveCare' ? <Preventive rows={s.data} /> : s.name === 'appointments' ? <Appointments rows={s.data} /> : s.name === 'admissions' ? <Admissions rows={s.data} /> : s.name === 'billing' ? <Billing data={s.data} currency={currency} /> : <Generic data={s.data} />}
        </Section>
      ))}

      {record.omitted.length > 0 && (
        <p className="mb-4 rounded border border-gray-400 p-2 text-sm text-gray-700">
          Not included because of your role: {record.omitted.join(', ')}. Ask a manager if you need a fuller copy.
        </p>
      )}
      <LetterFooter />
    </article>
  );
}
