import { enumLabel } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { fmtDate } from '@/lib/format';
import type { VaccinationCertificate } from '@/lib/types';

/** Printable vaccination certificate built from recorded administrations (product, batch, date, vet). */
export function CertificateDocument({ cert, clinic }: { cert: VaccinationCertificate; clinic: ClinicHeader | null }) {
  const p = cert.patient;
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-[11pt] text-black">
      <header className="mb-4 border-b-2 border-black pb-3 text-center">
        <p className="text-lg font-bold">{clinic?.legalName || clinic?.name}</p>
        <p className="text-sm">{[clinic?.addressLine1, clinic?.city, clinic?.phone].filter(Boolean).join(' · ')}</p>
        <p className="mt-2 text-xl font-bold tracking-wide">VACCINATION CERTIFICATE</p>
      </header>
      <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline font-semibold">Animal: </dt><dd className="inline">{p.name} (P-{String(p.number).padStart(6, '0')})</dd></div>
        <div><dt className="inline font-semibold">Species / breed: </dt><dd className="inline">{p.species}{p.breed ? ` · ${p.breed}` : ''}</dd></div>
        <div><dt className="inline font-semibold">Sex: </dt><dd className="inline">{enumLabel(p.sex)}</dd></div>
        <div><dt className="inline font-semibold">Date of birth: </dt><dd className="inline">{fmtDate(p.dateOfBirth)}</dd></div>
        {p.colour && <div><dt className="inline font-semibold">Colour: </dt><dd className="inline">{p.colour}</dd></div>}
        {p.identifiers.map((i) => <div key={i.value}><dt className="inline font-semibold">{enumLabel(i.type)}: </dt><dd className="inline">{i.value}</dd></div>)}
        <div className="col-span-2"><dt className="inline font-semibold">Owner: </dt><dd className="inline">{cert.owner?.displayName}{cert.owner?.addresses?.[0] ? `, ${cert.owner.addresses[0].line1}${cert.owner.addresses[0].city ? `, ${cert.owner.addresses[0].city}` : ''}` : ''}</dd></div>
      </dl>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-black text-left"><th className="py-1">Date</th><th>Vaccine</th><th>Product / manufacturer</th><th>Batch</th><th>Expiry</th><th>Given by</th></tr>
        </thead>
        <tbody>
          {cert.given.map((g) => (
            <tr key={g.id} className="border-b border-gray-300 align-top">
              <td className="py-1">{fmtDate(g.date)}</td>
              <td>{g.title}</td>
              <td>{g.product ?? '—'}{g.manufacturer ? ` (${g.manufacturer})` : ''}</td>
              <td>{g.batchNumber ?? '—'}</td>
              <td>{fmtDate(g.expiryDate)}</td>
              <td>{g.givenElsewhere ? 'Given elsewhere (owner record)' : g.givenBy}</td>
            </tr>
          ))}
          {!cert.given.length && <tr><td colSpan={6} className="py-2 text-center">No vaccinations recorded.</td></tr>}
        </tbody>
      </table>
      {!!cert.nextDue.length && <p className="mt-4 text-sm"><b>Next due:</b> {cert.nextDue.map((n) => `${n.title} — ${fmtDate(n.dueDate)}`).join('; ')}</p>}
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
        <p className="border-t border-black pt-1">Veterinarian signature</p>
        <p className="border-t border-black pt-1">Clinic stamp · issued {fmtDate(cert.generatedAt)}</p>
      </div>
    </article>
  );
}
