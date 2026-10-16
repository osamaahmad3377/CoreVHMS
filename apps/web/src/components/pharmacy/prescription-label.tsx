import { fmtDate } from '@/lib/format';
import type { Prescription } from '@/lib/types';

/** Printable dispensing labels (one per item). Shown only when printing. */
export function PrescriptionLabels({ rx, clinic }: { rx: Prescription; clinic: { name: string; phone?: string | null } }) {
  return (
    <div className="hidden print:block">
      {rx.items.map((i) => (
        <section key={i.id} className="mb-4 break-inside-avoid border border-black p-3 text-[11pt] leading-snug" style={{ width: '9cm' }}>
          <p className="font-bold">{i.product.name}</p>
          <p className="my-1 text-[12pt]">{i.instructions}</p>
          <p>
            {i.amountPerDose} {i.product.dispensingUnit} per dose · {i.frequencyText}
            {i.durationDays ? ` · ${i.durationDays} days` : ''}
          </p>
          <p>
            Qty: {i.quantity} {i.product.dispensingUnit}
            {i.repeats ? ` · repeats: ${i.repeats}` : ''}
          </p>
          <p className="mt-1">
            For: <b>{rx.patient.name}</b> ({rx.patient.species.name}) · Owner: {rx.client.displayName}
          </p>
          <p>
            {rx.prescriptionNo} · {fmtDate(rx.authorizedAt ?? rx.createdAt)} · {rx.prescriber?.name ?? rx.authorizedByName}
            {rx.prescriber?.registration ? ` (${rx.prescriber.registration})` : ''}
          </p>
          <p className="mt-1 text-[9pt]">
            {clinic.name}
            {clinic.phone ? ` · ${clinic.phone}` : ''} · FOR ANIMAL TREATMENT ONLY · Keep out of reach of children
          </p>
        </section>
      ))}
    </div>
  );
}
