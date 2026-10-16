'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../confirm';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Data-subject requests: download everything held about the client, or anonymise them. */
export function ClientPrivacy({ client }: { client: { id: string; displayName: string; anonymisedAt?: string | null; status: string } }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const anonymise = useMutation({
    mutationFn: (reason: string) => api.post(`/clients/${client.id}/anonymise`, { reason }),
    onSuccess: () => { toast.success('Client anonymised'); qc.invalidateQueries({ queryKey: ['client', client.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('privacy.manage') || client.status === 'MERGED') return null;
  return (
    <Card>
      <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/v1/clients/${client.id}/data-export`} download><Download /> Download all data (JSON)</a>
        </Button>
        {client.anonymisedAt ? (
          <p className="text-xs text-muted-foreground">Personal details were removed on request. Clinical and financial records are kept.</p>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            loading={anonymise.isPending}
            onClick={async () => {
              const c = await confirm({
                title: `Anonymise ${client.displayName}?`,
                description: 'Name, contact details, addresses, notes and message contents are removed permanently. Animals, clinical records and invoices are kept (record-keeping rules). The balance must be zero and no animal may be boarding or in hospital. This cannot be undone — download the data first if the client asked for a copy.',
                confirmLabel: 'Anonymise permanently',
                destructive: true,
                requireReason: true,
                reasonLabel: 'Reference to the client’s request',
              });
              if (c.confirmed) anonymise.mutate(c.reason!);
            }}
          >
            <ShieldOff /> Anonymise on request
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
