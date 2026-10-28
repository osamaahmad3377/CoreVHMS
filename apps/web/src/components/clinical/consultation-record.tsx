'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { LetterFooter, Letterhead } from '../documents/letterhead';
import { api, qs } from '@/lib/api';
import { fmtAge, fmtDate, fmtDateTime, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Administration, ClinicalNote, DiagnosticOrder, Encounter, Prescription } from '@/lib/types';

const NOTE_SECTIONS: { key: keyof ClinicalNote; label: string }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint' },
  { key: 'history', label: 'Past history' },
  { key: 'subjective', label: 'History from the owner' },
  { key: 'objective', label: 'Examination findings' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan — tests, treatment, advice' },
  { key: 'followUpInstructions', label: 'Instructions for the owner' },
];

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h2 className="mb-1.5 text-[10pt] font-bold uppercase tracking-wide">
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

const keep = 'print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]';
const table = 'w-full border-collapse border border-gray-400 text-[9.5pt]';
const th = `border border-gray-400 bg-gray-100 px-2 py-1 text-left font-semibold ${keep}`;
const td = 'border border-gray-400 px-2 py-1 align-top';
const label = `border border-gray-400 bg-gray-50 px-2 py-1 text-left align-top font-semibold w-[22%] ${keep}`;

/** A bordered table of label/value pairs, two pairs to a row; a pair marked `wide` takes the whole row. */
function DetailsTable({ rows }: { rows: { k: string; v: React.ReactNode; wide?: boolean }[] }) {
  const out: React.ReactNode[] = [];
  let pending: { k: string; v: React.ReactNode } | null = null;
  const flush = () => {
    if (!pending) return;
    out.push(
      <tr key={`r${out.length}`}>
        <th scope="row" className={label}>{pending.k}</th>
        <td className={td} colSpan={3}>{pending.v}</td>
      </tr>,
    );
    pending = null;
  };
  for (const r of rows) {
    if (r.wide) {
      flush();
      out.push(
        <tr key={`r${out.length}`}>
          <th scope="row" className={label}>{r.k}</th>
          <td className={td} colSpan={3}>{r.v}</td>
        </tr>,
      );
    } else if (pending) {
      const first: { k: string; v: React.ReactNode } = pending;
      out.push(
        <tr key={`r${out.length}`}>
          <th scope="row" className={label}>{first.k}</th>
          <td className={`${td} w-[28%]`}>{first.v}</td>
          <th scope="row" className={label}>{r.k}</th>
          <td className={`${td} w-[28%]`}>{r.v}</td>
        </tr>,
      );
      pending = null;
    } else {
      pending = r;
    }
  }
  flush();
  return (
    <table className={table}>
      <tbody>{out}</tbody>
    </table>
  );
}

const dash = <span className="text-gray-500">—</span>;

/**
 * The professional record of one consultation, laid out in tables: patient and visit details, vital signs,
 * the signed clinical notes, examination, tests, diagnosis, medicines given and prescribed, follow-up and the
 * vet's signature. It is a clinical document only — charges and bills are on the invoice, not here.
 * Medicines and tests appear only for people allowed to see them; unsigned draft notes are left out.
 */
export function ConsultationRecord({ encounter: e, clinic }: { encounter: Encounter; clinic: ClinicHeader | null }) {
  const { can } = useSession();
  const rx = useQuery({
    queryKey: ['prescriptions', { patientId: e.patient.id, encounterId: e.id }],
    queryFn: () => api.get<Paginated<Prescription>>(`/prescriptions${qs({ patientId: e.patient.id, encounterId: e.id, pageSize: 50 })}`),
    enabled: can('prescriptions.read'),
  });
  const given = useQuery({
    queryKey: ['administrations', e.patient.id, e.id],
    queryFn: () => api.get<Administration[]>(`/patients/${e.patient.id}/administrations${qs({ encounterId: e.id })}`),
    enabled: can('clinical.read'),
  });
  const labs = useQuery({
    queryKey: ['lab-orders', { patientId: e.patient.id, encounterId: e.id }],
    queryFn: () => api.get<Paginated<DiagnosticOrder>>(`/lab-orders${qs({ patientId: e.patient.id, encounterId: e.id, pageSize: 50 })}`),
    enabled: can('lab.read'),
  });

  const notes = e.notes.filter((n) => n.status === 'SIGNED');
  const vitals = e.vitals[0] ?? null;
  const prescriptions = (rx.data?.data ?? []).filter((p) => p.status !== 'CANCELLED');
  const administrations = (given.data ?? []).filter((a) => a.status === 'GIVEN');
  const orders = (labs.data?.data ?? []).filter((o) => o.status !== 'CANCELLED');
  const p = e.patient;
  const breed = typeof p.breed === 'string' ? p.breed : (p.breed?.name ?? p.breedText);
  const open = e.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');
  const alerts = p.alerts.filter((a) => a.isActive !== false);
  const exam = notes.flatMap((n) => (n.examFindings ?? []).filter((f) => f.status !== 'NOT_EXAMINED'));
  const signer = notes.at(-1);

  const vitalItems: [string, string | null][] = vitals
    ? [
        ['Temperature', vitals.temperatureC != null ? `${vitals.temperatureC} °C` : null],
        ['Heart rate', vitals.heartRate != null ? `${vitals.heartRate} /min` : null],
        ['Respiratory rate', vitals.respiratoryRate != null ? `${vitals.respiratoryRate} /min` : null],
        ['Weight', vitals.weightKg != null ? fmtWeight(vitals.weightKg) : null],
        ['Gums', vitals.mucousMembranes],
        ['Capillary refill', vitals.capillaryRefillSec != null ? `${vitals.capillaryRefillSec} s` : null],
        ['Pain score', vitals.painScore != null ? `${vitals.painScore}/10` : null],
        ['Blood pressure', vitals.systolicBp != null && vitals.diastolicBp != null ? `${vitals.systolicBp}/${vitals.diastolicBp} mmHg` : null],
        ['SpO₂', vitals.spo2 != null ? `${vitals.spo2} %` : null],
      ]
    : [];
  const shownVitals = vitalItems.filter(([, v]) => v);

  let n = 0;
  const next = () => ++n;

  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-[10pt] leading-snug text-black">
      <Letterhead
        clinic={clinic}
        aside={
          <div className="text-[9.5pt]">
            <p className="text-[12pt] font-bold uppercase tracking-wide">Consultation record</p>
            <p>No. <span className="font-semibold">{e.encounterNo}</span></p>
            <p>Date: {fmtDate(e.startedAt)}</p>
          </div>
        }
      />

      <Section n={next()} title="Patient and visit details">
        <DetailsTable
          rows={[
            { k: 'Patient', v: <><span className="font-semibold">{p.name}</span> ({p.patientNo})</> },
            { k: 'Owner', v: e.client.displayName },
            { k: 'Species / breed', v: [p.species.name, breed].filter(Boolean).join(', ') },
            { k: 'Phone', v: e.client.mobilePhone ?? dash },
            { k: 'Sex', v: p.sex ? enumLabel(p.sex) : dash },
            { k: 'Age', v: p.dateOfBirth ? fmtAge(p.dateOfBirth, p.dobEstimated) : dash },
            {
              k: 'Visit type',
              v: `${enumLabel(e.type)}${e.appointment && e.appointment.appointmentType.name !== enumLabel(e.type) ? ` (${e.appointment.appointmentType.name})` : ''}`,
            },
            { k: 'Veterinarian', v: e.clinician?.name ?? dash },
            { k: 'Started', v: fmtDateTime(e.startedAt) },
            { k: 'Finished', v: e.completedAt ? fmtDateTime(e.completedAt) : dash },
            ...(e.chiefComplaint ? [{ k: 'Reason for visit', v: e.chiefComplaint, wide: true }] : []),
            ...(alerts.length ? [{ k: 'Alerts', v: <span className="font-semibold">{alerts.map((a) => a.title ?? a.type).join('; ')}</span>, wide: true }] : []),
          ]}
        />
      </Section>

      {shownVitals.length > 0 && vitals && (
        <Section n={next()} title="Vital signs">
          <DetailsTable
            rows={[
              ...shownVitals.map(([k, v]) => ({ k, v })),
              ...(vitals.notes ? [{ k: 'Notes', v: vitals.notes, wide: true }] : []),
            ]}
          />
          <p className="mt-1 text-[8.5pt] text-gray-600">Recorded {fmtDateTime(vitals.recordedAt)}</p>
        </Section>
      )}

      <Section n={next()} title="Clinical notes">
        {notes.length > 0 ? (
          notes.map((note) => (
            <div key={note.id} className="mb-2">
              <table className={table}>
                <tbody>
                  {NOTE_SECTIONS.filter((s) => note[s.key]).map((s) => (
                    <tr key={s.key}>
                      <th scope="row" className={label}>{s.label}</th>
                      <td className={`${td} whitespace-pre-wrap`}>{String(note[s.key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[8.5pt] text-gray-600">
                Signed by {note.signedByName} on {fmtDateTime(note.signedAt)}
                {note.version > 1 ? ` · version ${note.version}` : ''}
              </p>
            </div>
          ))
        ) : (
          <p className="text-gray-600">No signed clinical note yet.</p>
        )}
      </Section>

      {exam.length > 0 && (
        <Section n={next()} title="Physical examination">
          <table className={table}>
            <thead>
              <tr>
                <th className={`${th} w-[30%]`}>Body system</th>
                <th className={`${th} w-[16%]`}>Result</th>
                <th className={th}>Findings</th>
              </tr>
            </thead>
            <tbody>
              {exam.map((f, i) => (
                <tr key={`${f.system}-${i}`}>
                  <td className={td}>{f.system}</td>
                  <td className={`${td} ${f.status === 'ABNORMAL' ? 'font-semibold' : ''}`}>{f.status === 'ABNORMAL' ? 'Abnormal' : 'Normal'}</td>
                  <td className={td}>{f.notes || dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {orders.length > 0 && (
        <Section n={next()} title="Tests ordered">
          <table className={table}>
            <thead>
              <tr>
                <th className={`${th} w-[18%]`}>Order no.</th>
                <th className={th}>Tests</th>
                <th className={`${th} w-[18%]`}>Status</th>
                <th className={`${th} w-[18%]`}>Results released</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className={td}>{o.orderNo}</td>
                  <td className={td}>{o.items.map((i) => i.test.name).join(', ')}</td>
                  <td className={td}>{enumLabel(o.status)}</td>
                  <td className={td}>{o.releasedAt ? fmtDate(o.releasedAt) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {e.diagnoses.length > 0 && (
        <Section n={next()} title="Diagnosis">
          <table className={table}>
            <thead>
              <tr>
                <th className={`${th} w-8 text-center`}>#</th>
                <th className={th}>Diagnosis</th>
                <th className={`${th} w-[16%]`}>Type</th>
                <th className={`${th} w-[14%]`}>Code</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {e.diagnoses.map((d, i) => (
                <tr key={d.id}>
                  <td className={`${td} text-center`}>{i + 1}</td>
                  <td className={`${td} font-semibold`}>{d.term}</td>
                  <td className={td}>{enumLabel(d.type)}</td>
                  <td className={td}>{d.code || dash}</td>
                  <td className={td}>{d.notes || dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {administrations.length > 0 && (
        <Section n={next()} title="Treatment given in the clinic">
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>Medicine</th>
                <th className={`${th} w-[14%]`}>Dose</th>
                <th className={`${th} w-[18%]`}>Route</th>
                <th className={`${th} w-[24%]`}>Given</th>
              </tr>
            </thead>
            <tbody>
              {administrations.map((a) => (
                <tr key={a.id}>
                  <td className={td}>
                    {a.product.name}
                    {a.notes ? <span className="block text-[8.5pt] text-gray-600">{a.notes}</span> : null}
                  </td>
                  <td className={td}>{a.dose} {a.doseUnit}</td>
                  <td className={td}>{enumLabel(a.route)}{a.site ? ` (${a.site})` : ''}</td>
                  <td className={td}>
                    {fmtDateTime(a.administeredAt)}
                    <span className="block text-[8.5pt] text-gray-600">{a.administeredByName}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {prescriptions.length > 0 && (
        <Section n={next()} title="Medicines prescribed">
          {prescriptions.map((rxn) => (
            <div key={rxn.id} className="mb-3">
              <p className="mb-1 text-[8.5pt] text-gray-600">
                <span className="font-semibold text-black">{rxn.prescriptionNo}</span>
                {rxn.prescriber ? ` · ${rxn.prescriber.name}` : ''}
                {rxn.weightKg ? ` · weight ${fmtWeight(rxn.weightKg)}` : ''}
                {rxn.validUntil ? ` · valid until ${fmtDate(rxn.validUntil)}` : ''}
              </p>
              <table className={table}>
                <thead>
                  <tr>
                    <th className={`${th} w-8 text-center`}>#</th>
                    <th className={th}>Medicine</th>
                    <th className={th}>Dose and how often</th>
                    <th className={`${th} w-[10%]`}>Days</th>
                    <th className={`${th} w-[12%]`}>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {rxn.items.map((i, idx) => (
                    <tr key={i.id}>
                      <td className={`${td} text-center`}>{idx + 1}</td>
                      <td className={td}>
                        <span className="font-semibold">{i.name}</span>
                        {i.outside ? <span className="block text-[8.5pt] text-gray-600">To buy from another pharmacy</span> : null}
                      </td>
                      <td className={td}>
                        {i.doseValue} {i.doseUnit} {enumLabel(i.route).toLowerCase()}, {i.frequencyText}
                        {i.instructions ? <span className="block text-[8.5pt] text-gray-600">{i.instructions}</span> : null}
                      </td>
                      <td className={td}>{i.durationDays ?? dash}</td>
                      <td className={td}>{i.quantity} {i.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rxn.notes && <p className="mt-1">{rxn.notes}</p>}
            </div>
          ))}
        </Section>
      )}

      {open.length > 0 && (
        <Section n={next()} title="Follow-up">
          <table className={table}>
            <thead>
              <tr>
                <th className={th}>What</th>
                <th className={`${th} w-[24%]`}>Due</th>
              </tr>
            </thead>
            <tbody>
              {open.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.title}</td>
                  <td className={td}>{t.dueAt ? fmtDate(t.dueAt) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <div className="mt-10 grid grid-cols-2 gap-10 break-inside-avoid text-[9.5pt]">
        <div>
          <div className="h-10 border-b border-gray-500" />
          <p className="mt-1 font-semibold">{signer?.signedByName ?? e.clinician?.name ?? 'Veterinarian'}</p>
          <p className="text-gray-600">Veterinarian&apos;s signature</p>
        </div>
        <div>
          <div className="h-10 border-b border-gray-500" />
          <p className="mt-1 font-semibold">{signer?.signedAt ? fmtDate(signer.signedAt) : ' '}</p>
          <p className="text-gray-600">Date</p>
        </div>
      </div>

      <p className="mt-6 text-[9pt]">Questions about this visit? Contact us{clinic?.phone ? ` on ${clinic.phone}` : ''}.</p>
      <p className="mt-1 text-[8pt] text-gray-600">Printed {fmtDateTime(new Date())} · This is a clinical record and not a bill.</p>
      <LetterFooter />
    </article>
  );
}
