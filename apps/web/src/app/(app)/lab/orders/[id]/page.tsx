'use client';
import { useParams } from 'next/navigation';
import { LabOrderDetail } from '@/components/lab/order-detail';
import { RequirePermission } from '@/components/require';

export default function LabOrderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequirePermission anyOf={['lab.read']}>
      <LabOrderDetail id={id} />
    </RequirePermission>
  );
}
