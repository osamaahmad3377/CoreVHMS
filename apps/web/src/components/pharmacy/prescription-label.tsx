import { findFrequency, ownerAmount, ownerLabelText } from '@vcms/shared';
import type { ClinicHeader } from '../billing/invoice-document';
import { fmtDate, fmtDateOnly } from '@/lib/format';
import { qtyUnit } from '@/lib/labels';
import type { Prescription } from '@/lib/types';

/** Owner as written on a label: "QA Clinical Tester" rather than the sort name "Clinical Tester, QA". */
export function ownerName(c: Prescription['client']) {
  return c.organizationName || [c.title, c.firstName, c.lastName].filter(Boolean).join(' ') || c.displayName;
}


/** Printable dispensing labels (one per item). Shown only when printing. */
export function PrescriptionLabels({ rx, clinic }: { rx: Prescription; clinic: ClinicHeader }) {
  const address = [clinic.addressLine1, clinic.addressLine2, clinic.city, clinic.postcode].filter(Boolean).join(', ');
  return (
    <div className="hidden print:block">
      {rx.items.map((i) => {
        const last = i.dispensations[i.dispensations.length - 1];
        return (
          <section key={i.id} className="mb-4 break-inside-avoid border border-black p-3 text-[11pt] leading-snug" style={{ width: '9cm' }}>
            <p className="font-bold">{i.product.name}</p>
            {/* Owner labels never carry Latin abbreviations (BID, PO…): older text is written out in plain words. */}
            <p className="my-1 text-[12pt]">{ownerLabelText(i.instructions)}</p>
            <p>
              {ownerAmount(i.amountPerDose, i.product.dispensingUnit)} each time · {findFrequency(i.frequencyText)?.ownerText ?? ownerLabelText(i.frequencyText)}
              {i.durationDays ? ` · ${i.durationDays} days` : ''}
            </p>
            <p>
              Quantity: {qtyUnit(last?.quantity ?? i.quantity, i.product.dispensingUnit)}
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
