'use client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClientForm } from '@/components/clients/client-form';
import { PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Card, CardContent } from '@/components/ui/card';

export default function NewClientPage() {
  const router = useRouter();
  return (
    <RequirePermission anyOf={['clients.write']}>
      <PageHeader title="Add client" breadcrumbs={[{ label: 'Clients', href: '/clients' }, { label: 'Add client' }]} />
      <Card className="max-w-5xl">
        <CardContent className="pb-0 pt-5">
          <ClientForm
            onSaved={(c) => {
              toast.success(c.displayName ? `Client added: ${c.displayName}${c.clientNo ? ` (${c.clientNo})` : ''}` : 'Client added');
              router.push(`/clients/${c.id}?registered=1`);
            }}
            onCancel={() => router.back()}
          />
        </CardContent>
      </Card>
    </RequirePermission>
  );
}
