import { redirect } from 'next/navigation';

/** Dental prices now sit with the Dental appointment types. */
export default function DentalPricesPage() {
  redirect('/settings/appointment-types#dental-prices');
}
