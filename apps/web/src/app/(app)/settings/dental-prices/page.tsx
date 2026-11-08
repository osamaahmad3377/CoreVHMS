import { redirect } from 'next/navigation';

/** Dental procedures are appointment types now, each with its price, in the Dental category. */
export default function DentalPricesPage() {
  redirect('/settings/appointment-types');
}
