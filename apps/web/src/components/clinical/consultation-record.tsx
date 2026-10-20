'use client';
import { useQuery } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { LetterFooter, Letterhead } from '../documents/letterhead';
import { api, qs } from '@/lib/api';
import { fmtAge, fmtDate, fmtDateTime, fmtMoney, fmtWeight } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Administration, Charge, ClinicalNote, DiagnosticOrder, Encounter, Prescription } from '@/lib/types';

const NOTE_SECTIONS: { key: keyof ClinicalNote; label: string }[] = [
  { key: 'presentingComplaint', label: 'Presenting complaint' },
  { key: 'history', label: 'Past history' },
  { key: 'subjective', label: 'History from the owner' },
  { key: 'objective', label: 'Examination findings' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'plan', label: 'Plan — tests, treatment, advice' },
  { key: 'followUpInstructions', label: 'Instructions for the owner' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 break-inside-avoid">
      <h2 className="mb-1 border-b border-gray-300 pb-0.5 text-[10pt] font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

const th = 'border-b border-gray-400 px-1.5 py-1 text-left font-semibold';
const td = 'border-b border-gray-200 px-1.5 py-1 align-top';

/**
 * Printable record of one consultation: patient and owner, vitals, the signed clinical note, diagnoses,
 * medicines prescribed and given, tests ordered, charges and follow-up. Charges, medicines and tests only
 * appear for people allowed to see them. Only signed notes are printed; unsigned drafts are left out.
 */
export function ConsultationRecord({ encounter: e, clinic }: { encounter: Encounter; clinic: ClinicHeader | null }) {
  const { can, currency } = useSession();
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
  const charges = useQuery({
    queryKey: ['charges', { encounterId: e.id }],
    queryFn: () => api.get<Paginated<Charge> & { totalMinor: number }>(`/charges${qs({ encounterId: e.id, status: 'ALL', pageSize: 50 })}`),
    enabled: can('billing.read'),
  });

  const notes = e.notes.filter((n) => n.status === 'SIGNED');
  const vitals = e.vitals[0] ?? null;
  const prescriptions = (rx.data?.data ?? []).filter((p) => p.status !== 'CANCELLED');
  const administrations = (given.data ?? []).filter((a) => a.status === 'GIVEN');
  const orders = (labs.data?.data ?? []).filter((o) => o.status !== 'CANCELLED');
  const lines = (charges.data?.data ?? []).filter((c) => c.status !== 'WAIVED');
  const total = lines.reduce((n, c) => n + Math.round(c.quantity * c.unitPriceMinor), 0);
  const p = e.patient;
  const breed = typeof p.breed === 'string' ? p.breed : (p.breed?.name ?? p.breedText);
  const open = e.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED');

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

  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-[10.5pt] leading-snug text-black">
      <Letterhead
        clinic={clinic}
        title={<p className="text-base font-bold">Consultation record — {e.encounterNo}</p>}
      />

      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline font-semibold">Patient: </dt><dd className="inline">{p.name} ({p.patientNo})</dd></div>
        <div><dt className="inline font-semibold">Owner: </dt><dd className="inline">{e.client.displayName}{e.client.mobilePhone ? ` · ${e.client.mobilePhone}` : ''}</dd></div>
        <div><dt className="inline font-semibold">Species: </dt><dd className="inline">{p.species.name}{breed ? `, ${breed}` : ''}</dd></div>
        <div><dt className="inline font-semibold">Sex / age: </dt><dd className="inline">{[enumLabel(p.sex), p.dateOfBirth ? fmtAge(p.dateOfBirth, p.dobEstimated) : null].filter(Boolean).join(' · ')}</dd></div>
        <div><dt className="inline font-semibold">Visit: </dt><dd className="inline">{enumLabel(e.type)}{e.appointment && e.appointment.appointmentType.name !== enumLabel(e.type) ? ` (${e.appointment.appointmentType.name})` : ''}</dd></div>
        <div><dt className="inline font-semibold">Vet: </dt><dd className="inline">{e.clinician?.name ?? '—'}</dd></div>
        <div><dt className="inline font-semibold">Started: </dt><dd className="inline">{fmtDateTime(e.startedAt)}</dd></div>
        <div><dt className="inline font-semibold">Finished: </dt><dd className="inline">{fmtDateTime(e.completedAt)}</dd></div>
      </dl>
      {p.alerts.some((a) => a.isActive !== false) && (
        <p className="mb-4 rounded border border-gray-400 px-2 py-1 text-sm">
          <span className="font-semibold">Alerts: </span>
          {p.alerts.filter((a) => a.isActive !== false).map((a) => a.title ?? a.type).join('; ')}
        </p>
      )}

      {e.chiefComplaint && (
        <Section title="Reason for visit">
          <p>{e.chiefComplaint}</p>
        </Section>
      )}

      {shownVitals.length > 0 && vitals && (
        <Section title={`Vital signs — ${fmtDateTime(vitals.recordedAt)}`}>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-sm">
            {shownVitals.map(([k, v]) => (
              <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline">{v}</dd></div>
            ))}
          </dl>
          {vitals.notes && <p className="mt-1 text-sm">{vitals.notes}</p>}
        </Section>
      )}

      {notes.length > 0 ? (
        notes.map((n) => (
          <Section key={n.id} title="Clinical notes">
            <dl className="grid gap-2">
              {NOTE_SECTIONS.filter((s) => n[s.key]).map((s) => (
                <div key={s.key}>
                  <dt className="text-[9pt] font-semibold uppercase tracking-wide text-gray-600">{s.label}</dt>
                  <dd className="whitespace-pre-wrap">{String(n[s.key])}</dd>
                </div>
              ))}
            </dl>
            {!!n.examFindings?.filter((f) => f.status !== 'NOT_EXAMINED').length && (
              <div className="mt-2">
                <p className="text-[9pt] font-semibold uppercase tracking-wide text-gray-600">Physical examination</p>
                <ul className="grid grid-cols-2 gap-x-4 text-sm">
                  {n.examFindings.filter((f) => f.status !== 'NOT_EXAMINED').map((f) => (
                    <li key={f.system}>{f.status === 'ABNORMAL' ? '✗' : '✓'} {f.system}{f.notes ? ` — ${f.notes}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-600">
              Signed by {n.signedByName} on {fmtDateTime(n.signedAt)}{n.version > 1 ? ` · version ${n.version}` : ''}
            </p>
          </Section>
        ))
      ) : (
        <Section title="Clinical notes"><p className="text-sm text-gray-600">No signed clinical note yet.</p></Section>
      )}

      {e.diagnoses.length > 0 && (
        <Section title="Diagnosis">
          <ul className="list-disc pl-5">
            {e.diagnoses.map((d) => (
              <li key={d.id}>
                <span className="font-semibold">{d.term}</span> <span className="text-gray-600">({enumLabel(d.type)}{d.code ? ` · ${d.code}` : ''})</span>
                {d.notes ? ` — ${d.notes}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {administrations.length > 0 && (
        <Section title="Medicine given in the clinic">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Medicine</th><th className={th}>Dose</th><th className={th}>Route</th><th className={th}>Given</th></tr></thead>
            <tbody>
              {administrations.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.product.name}{a.notes ? <span className="block text-xs text-gray-600">{a.notes}</span> : null}</td>
                  <td className={td}>{a.dose} {a.doseUnit}</td>
                  <td className={td}>{enumLabel(a.route)}{a.site ? ` (${a.site})` : ''}</td>
                  <td className={td}>{fmtDateTime(a.administeredAt)}<span className="block text-xs text-gray-600">{a.administeredByName}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {prescriptions.length > 0 && (
        <Section title="Medicines prescribed">
          {prescriptions.map((rxn) => (
            <div key={rxn.id} className="mb-2">
              <p className="text-xs text-gray-600">
                {rxn.prescriptionNo}{rxn.prescriber ? ` · ${rxn.prescriber.name}` : ''}{rxn.weightKg ? ` · weight ${fmtWeight(rxn.weightKg)}` : ''}{rxn.validUntil ? ` · valid until ${fmtDate(rxn.validUntil)}` : ''}
              </p>
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Medicine</th><th className={th}>How to give</th><th className={th}>For</th><th className={th}>Qty</th></tr></thead>
                <tbody>
                  {rxn.items.map((i) => (
                    <tr key={i.id}>
                      <td className={td}>{i.product.name}</td>
                      <td className={td}>
                        {i.doseValue} {i.doseUnit} {enumLabel(i.route).toLowerCase()}, {i.frequencyText}
                        {i.instructions ? <span className="block text-xs text-gray-600">{i.instructions}</span> : null}
                      </td>
                      <td className={td}>{i.durationDays ? `${i.durationDays} days` : '—'}</td>
                      <td className={td}>{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rxn.notes && <p className="mt-1 text-sm">{rxn.notes}</p>}
            </div>
          ))}
        </Section>
      )}

      {orders.length > 0 && (
        <Section title="Tests ordered">
          <ul className="text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                {o.items.map((i) => i.test.name).join(', ')} <span className="text-gray-600">— {o.orderNo}, {enumLabel(o.status)}{o.releasedAt ? ` ${fmtDate(o.releasedAt)}` : ''}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {lines.length > 0 && (
        <Section title="Charges">
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Item</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Amount</th></tr></thead>
            <tbody>
              {lines.map((c) => (
                <tr key={c.id}>
                  <td className={td}>{c.description}</td>
                  <td className={`${td} text-right`}>{c.quantity}</td>
                  <td className={`${td} text-right`}>{fmtMoney(Math.round(c.quantity * c.unitPriceMinor), currency)}</td>
                </tr>
              ))}
              <tr><td className={`${td} font-semibold`} colSpan={2}>Total (before tax and discounts)</td><td className={`${td} text-right font-semibold`}>{fmtMoney(total, currency)}</td></tr>
            </tbody>
          </table>
        </Section>
      )}

      {open.length > 0 && (
        <Section title="Follow-up">
          <ul className="list-disc pl-5 text-sm">
            {open.map((t) => <li key={t.id}>{t.title} — {fmtDate(t.dueAt)}</li>)}
          </ul>
        </Section>
      )}

      <p className="mt-6 text-sm">Questions about this visit? Contact us{clinic?.phone ? ` on ${clinic.phone}` : ''}.</p>
      <p className="mt-4 text-xs text-gray-600">Printed {fmtDateTime(new Date())}</p>
      <LetterFooter />
    </article>
  );
}
