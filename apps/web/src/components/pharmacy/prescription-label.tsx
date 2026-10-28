import { findFrequency, ownerAmount, ownerLabelText } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { fmtDate, fmtDateOnly } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import type { Prescription } from '@/lib/types';

/** Owner as written on a label: "QA Clinical Tester" rather than the sort name "Clinical Tester, QA". */
export function ownerName(c: Prescription['client']) {
  return c.organizationName || [c.title, c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName;
}


/**
 * Printable dispensing labels (one per medicine handed out here), plus a written prescription the client
 * takes to another pharmacy for medicines the clinic does not stock. Shown only when printing.
 */
export function PrescriptionLabels({ rx, clinic }: { rx: Prescription; clinic: ClinicHeader }) {
  const address = [clinic.addressLine1, clinic.addressLine2, clinic.city, clinic.postcode].filter(Boolean).join(', ');
  const outside = rx.items.filter((i) => i.outside);
  return (
    <div className="hidden print:block">
      {outside.length > 0 && <OutsidePrescription rx={rx} items={outside} clinic={clinic} address={address} />}
      {rx.items.filter((i) => !i.outside).map((i) => {
        const last = i.dispensations[i.dispensations.length - 1];
        return (
          <section key={i.id} className="mb-4 break-inside-avoid border border-black p-3 text-[11pt] leading-snug" style={{ width: '9cm' }}>
            <p className="font-bold">{i.name}</p>
            {/* Owner labels never carry Latin abbreviations (BID, PO…): older text is written out in plain words. */}
            <p className="my-1 text-[12pt]">{ownerLabelText(i.instructions)}</p>
            <p>
              {ownerAmount(i.amountPerDose, i.unit)} each time · {findFrequency(i.frequencyText)?.ownerText ?? ownerLabelText(i.frequencyText)}
              {i.durationDays ? ` · ${i.durationDays} days` : ''}
            </p>
            <p>
              Quantity: {qtyUnit(last?.quantity ?? i.quantity, i.unit)}
              {i.repeats ? ` · refills: ${i.repeats}` : ''}
            </p>
            {last && (last.batchNumber || last.expiryDate) && (
              <p>
                {last.batchNumber && `Batch ${last.batchNumber}`}
                {last.batchNumber && last.expiryDate && ' · '}
                {last.expiryDate && `Use before ${fmtDateOnly(last.expiryDate)}`}
              </p>
            )}
            <p className="mt-1">
              For: <b>{rx.patient.name}</b> ({rx.patient.species.name}) · Owner: {ownerName(rx.client)}
            </p>
            <p>
              {rx.prescriptionNo} · {fmtDate(last?.dispensedAt ?? rx.authorizedAt ?? rx.createdAt)} · {rx.prescriber?.name ?? rx.authorizedByName}
              {rx.prescriber?.registration ? ` (${rx.prescriber.registration})` : ''}
            </p>
            <p className="mt-1 border-t border-black pt-1 text-[9pt]">
              <b>{clinic.legalName || clinic.name}</b>
              {address ? ` · ${address}` : ''}
              {clinic.phone ? ` · ${clinic.phone}` : ''}
            </p>
            <p className="text-[9pt]">FOR ANIMAL TREATMENT ONLY · Keep out of reach of children</p>
          </section>
        );
      })}
    </div>
  );
}

/** A written prescription for medicines the client buys from another pharmacy: clinic, patient, medicines, vet and signature. */
function OutsidePrescription({ rx, items, clinic, address }: { rx: Prescription; items: Prescription['items']; clinic: ClinicHeader; address: string }) {
  const vet = rx.prescriber?.name ?? rx.authorizedByName ?? rx.createdByName;
  return (
    <section className="mb-6 break-inside-avoid border border-black p-5 text-[11pt] leading-snug">
      <div className="flex items-start justify-between gap-4 border-b border-black pb-2">
        <div>
          <p className="text-[14pt] font-bold">{clinic.legalName || clinic.name}</p>
          <p className="text-[9pt]">{[address, clinic.phone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="text-[13pt] font-bold">Prescription</p>
          <p className="text-[9pt]">{rx.prescriptionNo} · {fmtDate(rx.authorizedAt ?? rx.createdAt)}</p>
        </div>
      </div>
      <p className="mt-2">
        Patient: <b>{rx.patient.name}</b> ({rx.patient.species.name}){rx.weightKg ? ` · ${rx.weightKg} kg` : ''} · Owner: {ownerName(rx.client)}
        {rx.client.mobilePhone ? ` · ${rx.client.mobilePhone}` : ''}
      </p>
      <ol className="mt-3 grid list-decimal gap-2 pl-6">
        {items.map((i) => (
          <li key={i.id}>
            <p className="font-bold">{i.name}</p>
            <p>{ownerLabelText(i.instructions)}</p>
            <p className="text-[10pt]">
              {ownerAmount(i.amountPerDose, i.unit)} each time · {findFrequency(i.frequencyText)?.ownerText ?? ownerLabelText(i.frequencyText)}
              {i.durationDays ? ` · ${i.durationDays} days` : ''} · Quantity: {qtyUnit(i.quantity, i.unit)}
              {i.repeats ? ` · refills: ${i.repeats}` : ''}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="text-[9pt]">FOR ANIMAL TREATMENT ONLY</p>
        <div className="w-64 border-t border-black pt-1 text-center text-[10pt]">
          {vet}
          {rx.prescriber?.registration ? ` · Reg. ${rx.prescriber.registration}` : ''}
          <br />
          Signature
        </div>
      </div>
    </section>
  );
}
