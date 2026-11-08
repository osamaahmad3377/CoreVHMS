'use client';
import { QuickConsult } from '@/components/quick-consult/quick-consult';
import { RequirePermission } from '@/components/require';

/** Quick consult: the whole visit on one screen. The classic consultation page is unchanged at /consultations/[id]. */
export default function QuickConsultPage() {
  return (
    <RequirePermission anyOf={['clinical.read']}>
      <QuickConsult />
    </RequirePermission>
  );
}
