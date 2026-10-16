'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel, type Paginated } from '@vcms/shared';
import { Globe, MessageSquare, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { MessageStatusBadge } from './badges';
import { SendMessageDialog } from './send-message-dialog';
import { useConfirm } from '../confirm';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { api } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { OutboundMessage, PortalStatus } from '@/lib/types';

/** Client portal access: invite, resend, revoke. */
export function PortalCard({ client }: { client: { id: string; email: string | null; status: string } }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['portal-status', client.id], queryFn: () => api.get<PortalStatus>(`/clients/${client.id}/portal`) });
  const act = useMutation({
    mutationFn: (action: 'portal-invite' | 'portal-revoke') => api.post<PortalStatus>(`/clients/${client.id}/${action}`),
    onSuccess: (s, action) => { qc.setQueryData(['portal-status', client.id], s); toast.success(action === 'portal-invite' ? `Invitation emailed to ${s.email}` : 'Portal access switched off'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = q.data;
  const canManage = can('communications.send') && client.status === 'ACTIVE';
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> Client portal</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {!s ? <p className="text-muted-foreground">Loading…</p> : !s.invited ? (
          <p className="text-muted-foreground">Not invited. The client can see vaccinations, appointments, results, invoices and message you.</p>
        ) : !s.isActive ? (
          <p><Badge variant="secondary">Access off</Badge> {s.email}</p>
        ) : s.accountStatus === 'ACTIVE' ? (
          <p><Badge variant="success">Active</Badge> {s.email}<span className="block text-xs text-muted-foreground">{s.lastLoginAt ? `Last signed in ${fmtRelative(s.lastLoginAt)}` : 'Not signed in yet'}</span></p>
        ) : (
          <p><Badge variant="info">Invited</Badge> {s.email}<span className="block text-xs text-muted-foreground">Waiting for the client to set a password · invited {fmtRelative(s.invitedAt)}</span></p>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {!client.email ? <p className="text-xs text-warning">Add an email address to invite this client.</p> : (
              <Button size="sm" variant={s?.invited && s.isActive ? 'outline' : 'default'} loading={act.isPending && act.variables === 'portal-invite'} onClick={() => act.mutate('portal-invite')}>
                {s?.invited && s.isActive ? (s.accountStatus === 'ACTIVE' ? 'Send login link' : 'Resend invitation') : 'Invite to portal'}
              </Button>
            )}
            {s?.invited && s.isActive && can('clients.write') && (
              <Button size="sm" variant="ghost" onClick={async () => (await confirm({ title: 'Switch off portal access?', description: 'The client is signed out and can no longer use the portal for this clinic.', destructive: true, confirmLabel: 'Switch off' })).confirmed && act.mutate('portal-revoke')}>Switch off</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A client's message history (reminders, manual messages) with a compose button. */
export function ClientCommunications({ client }: { client: { id: string; displayName: string; email: string | null; mobilePhone: string | null; preferredChannel: string; remindersConsent: boolean } }) {
  const { can, session } = useSession();
  const portal = session.features?.clientPortal === true;
  const [composing, setComposing] = useState(false);
  const q = useQuery({ queryKey: ['messages', 'client', client.id], queryFn: () => api.get<Paginated<OutboundMessage>>(`/messages?clientId=${client.id}&pageSize=100`), enabled: can('communications.read') });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {can('communications.send') && <Button size="sm" onClick={() => setComposing(true)}><Send /> Send message</Button>}
        {portal && can('communications.read') && <Button size="sm" variant="outline" asChild><Link href={`/communications?tab=inbox&client=${client.id}`}><MessageSquare /> Secure messages</Link></Button>}
        <span className="text-xs text-muted-foreground">Prefers {enumLabel(client.preferredChannel)} · reminders {client.remindersConsent ? 'on' : 'off (opted out)'}</span>
      </div>
      <Card>
        {q.data?.data.length ? (
          <ul className="divide-y">
            {q.data.data.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{m.subject ?? enumLabel(m.purpose)} <span className="text-xs font-normal text-muted-foreground">· {enumLabel(m.channel)} to {m.recipient}</span></p>
                  <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
                  <p className="text-2xs text-muted-foreground">{fmtDateTime(m.createdAt)} · {m.createdByName}{m.lastError ? ` · ${m.lastError}` : ''}</p>
                </div>
                <MessageStatusBadge status={m.status} />
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-muted-foreground">No messages sent to this client yet.</p>}
      </Card>
      <SendMessageDialog client={client} open={composing} onOpenChange={setComposing} />
    </div>
  );
}
