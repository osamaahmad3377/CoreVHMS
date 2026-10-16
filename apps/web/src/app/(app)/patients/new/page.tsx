'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { LoadingRows, PageHeader } from '@/components/page';
import { PatientForm } from '@/components/patients/patient-form';
import { RequirePermission } from '@/components/require';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import type { ClientDetail } from '@/lib/types';

function NewPatient() {
  const router = useRouter();
  const ownerId = useSearchParams().get('ownerId');
  const owner = useQuery({ queryKey: ['client', ownerId], queryFn: () => api.get<ClientDetail>(`/clients/${ownerId}`), enabled: !!ownerId });
  if (ownerId && owner.isLoading) return <LoadingRows />;
  const initialOwner = owner.data ? { id: owner.data.id, displayName: owner.data.displayName, clientNo: owner.data.clientNo } : null;
  return (
    <>
      <PageHeader
        title="Register patient"
        breadcrumbs={[{ label: 'Patients', href: '/patients' }, { label: 'Register' }]}
        description={initialOwner ? `Owner: ${initialOwner.displayName}` : undefined}
      />
      <Card className="max-w-5xl">
        <CardContent className="pb-0 pt-5">
          <PatientForm
            initialOwner={initialOwner}
            onSaved={(p) => {
              toast.success('Patient registered');
              router.push(`/patients/${p.id}`);
            }}
            onCancel={() => router.back()}
          />
        </CardContent>
      </Card>
    </>
  );
}

export default function NewPatientPage() {
  return (
    <RequirePermission anyOf={['patients.write']}>
      <Suspense>
        <NewPatient />
      </Suspense>
    </RequirePermission>
  );
}
