'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MESSAGE_CHANNELS, MESSAGE_STATUSES, enumLabel, type Paginated } from '@vcms/shared';
import { AlertTriangle, CalendarPlus, Inbox, MessageSquare, RefreshCw, Send, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { MessageStatusBadge } from '@/components/comms/badges';
import { useConfirm } from '@/components/confirm';
import { DataTable } from '@/components/data-table';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { useUrlState } from '@/hooks/use-url-state';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import { usePortalEnabled, useSession } from '@/lib/session';
import type { AppointmentRequestRow, ClientMessage, OutboundMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

type Log = Paginated<OutboundMessage> & { last30Days: Record<string, number>; channels: { channel: string; configured: boolean; provider: string }[] };

function MessageLog() {
  const qc = useQueryClient();
  const { can } = useSession();
  const url = useUrlState();
  const [open, setOpen] = useState<string | null>(null);
  const params = { status: url.get('status'), channel: url.get('channel'), page: Number(url.get('page', '1')), pageSize: 50 };
  const q = useQuery({ queryKey: ['messages', params], queryFn: () => api.get<Log>(`/messages${qs(params)}`), placeholderData: (p) => p, refetchInterval: 20_000 });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'cancel' }) => api.post(`/messages/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const run = useMutation({
    mutationFn: () => api.post<{ careDue: number; careOverdue: number; appointments: number }>('/reminders/run'),
    onSuccess: (r) => { toast.success(`Reminders queued: ${r.careDue} care due, ${r.careOverdue} overdue, ${r.appointments} appointments`); qc.invalidateQueries({ queryKey: ['messages'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const missing = q.data?.channels.filter((c) => !c.configured) ?? [];
  return (
    <div className="grid gap-4">
      {!!missing.length && (
        <Card className="border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="mr-2 inline h-4 w-4 text-warning" />
          {missing.map((c) => enumLabel(c.channel)).join(' and ')} {missing.length > 1 ? 'are' : 'is'} not connected to a provider yet, so those messages are logged as <b>Not sent</b>. Email is delivered{q.data?.channels.find((c) => c.channel === 'EMAIL')?.provider === 'SMTP' ? ' through your mail server' : ''}. Reminders fall back to email when the client has an email address.
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['SENT', 'QUEUED', 'SKIPPED', 'FAILED'] as const).map((s) => (
          <button key={s} type="button" onClick={() => url.set({ status: params.status === s ? null : s, page: 1 })} className={cn('rounded-lg border bg-card p-3 text-left shadow-sm hover:border-primary/50', params.status === s && 'border-primary ring-1 ring-primary/30')}>
            <p className="text-xs text-muted-foreground">{enumLabel(s)} · last 30 days</p>
            <p className={cn('text-2xl font-semibold tabular', s === 'FAILED' && (q.data?.last30Days.FAILED ?? 0) > 0 && 'text-destructive')}>{q.data?.last30Days[s] ?? 0}</p>
          </button>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <NativeSelect aria-label="Status" className="sm:w-40" value={params.status} onChange={(e) => url.set({ status: e.target.value, page: 1 })}>
            <option value="">All statuses</option>{MESSAGE_STATUSES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Channel" className="sm:w-40" value={params.channel} onChange={(e) => url.set({ channel: e.target.value, page: 1 })}>
            <option value="">All channels</option>{MESSAGE_CHANNELS.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}
          </NativeSelect>
          {can('communications.send') && <Button size="sm" variant="outline" className="sm:ml-auto" loading={run.isPending} onClick={() => run.mutate()}><RefreshCw /> Run reminders now</Button>}
        </div>
        <DataTable
          query={q}
          rowKey={(m) => m.id}
          page={params.page}
          pageSize={50}
          onPage={(page) => url.set({ page })}
          onRowClick={(m) => setOpen((o) => (o === m.id ? null : m.id))}
          empty={<EmptyState icon={Send} title="No messages yet" description="Reminders and messages to clients appear here with their delivery status." />}
          columns={[
            { key: 'when', header: 'Created', cell: (m) => <span className="whitespace-nowrap text-xs">{fmtDateTime(m.createdAt)}<span className="block text-muted-foreground">{m.createdByName}</span></span> },
            { key: 'client', header: 'Client', cell: (m) => (m.client ? <Link className="text-sm hover:underline" href={`/clients/${m.client.id}`}>{m.client.displayName}</Link> : <span className="text-sm text-muted-foreground">—</span>) },
            { key: 'what', header: 'Message', cell: (m) => <div className="max-w-md"><p className="truncate text-sm font-medium">{m.subject ?? enumLabel(m.purpose)}</p><p className={cn('text-xs text-muted-foreground', open === m.id ? 'whitespace-pre-wrap' : 'truncate')}>{m.body}</p></div> },
            { key: 'ch', header: 'Channel', cell: (m) => <span className="text-sm">{enumLabel(m.channel)}<span className="block text-xs text-muted-foreground">{m.recipient}</span></span> },
            { key: 'st', header: 'Status', cell: (m) => <span><MessageStatusBadge status={m.status} />{m.lastError && <span className="block max-w-[200px] truncate text-2xs text-muted-foreground" title={m.lastError}>{m.lastError}</span>}{m.sentAt && <span className="block text-2xs text-muted-foreground">{fmtDateTime(m.sentAt)}</span>}</span> },
            {
              key: 'act',
              header: '',
              cell: (m) =>
                can('communications.send') && (
                  <span className="flex gap-1">
                    {m.status === 'FAILED' && <Button size="sm" variant="outline" onClick={() => act.mutate({ id: m.id, action: 'retry' })}>Retry</Button>}
                    {m.status === 'QUEUED' && <Button size="icon-sm" variant="ghost" aria-label="Cancel message" onClick={() => act.mutate({ id: m.id, action: 'cancel' })}><X /></Button>}
                  </span>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

interface InboxRow { client: { id: string; displayName: string }; last: { body: string; subject: string | null; kind: string; direction: string; createdAt: string }; unread: number }

function ClientInbox() {
  const qc = useQueryClient();
  const { can } = useSession();
  const url = useUrlState();
  const selected = url.get('client');
  const [reply, setReply] = useState('');
  const inbox = useQuery({ queryKey: ['client-messages'], queryFn: () => api.get<InboxRow[]>('/client-messages'), refetchInterval: 20_000 });
  const thread = useQuery({ queryKey: ['client-messages', selected], queryFn: () => api.get<{ client: { id: string; displayName: string }; messages: ClientMessage[] }>(`/client-messages/${selected}`), enabled: !!selected });
  const send = useMutation({
    mutationFn: () => api.post('/client-messages', { clientId: selected, body: reply }),
    onSuccess: () => { setReply(''); qc.invalidateQueries({ queryKey: ['client-messages'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card className="max-h-[70vh] overflow-y-auto">
        {inbox.data?.length ? (
          <ul className="divide-y">
            {inbox.data.map((r) => (
              <li key={r.client.id}>
                <button type="button" onClick={() => url.set({ client: r.client.id })} className={cn('flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/60', selected === r.client.id && 'bg-primary/5')}>
                  <span className="flex items-center justify-between gap-2"><span className={cn('truncate text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.client.displayName}</span>{r.unread > 0 && <Badge>{r.unread} new</Badge>}</span>
                  <span className="truncate text-xs text-muted-foreground">{r.last.kind === 'FEEDBACK' ? 'Feedback: ' : ''}{r.last.direction === 'OUTBOUND' ? 'You: ' : ''}{r.last.subject ? `${r.last.subject} — ` : ''}{r.last.body}</span>
                  <span className="text-2xs text-muted-foreground">{fmtRelative(r.last.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={Inbox} title="No client messages" description="Messages and feedback sent from the client portal appear here." />}
      </Card>
      <Card className="flex min-h-[400px] flex-col">
        {selected && thread.data ? (
          <>
            <CardHeader><CardTitle><Link className="hover:underline" href={`/clients/${thread.data.client.id}`}>{thread.data.client.displayName}</Link></CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {thread.data.messages.map((m) => (
                <div key={m.id} className={cn('max-w-[80%] rounded-lg px-3 py-2 text-sm', m.direction === 'INBOUND' ? 'self-start bg-muted' : 'self-end bg-primary text-primary-foreground')}>
                  {m.kind === 'FEEDBACK' && <Badge variant="warning" className="mb-1">Feedback</Badge>}
                  {m.subject && <p className="font-semibold">{m.subject}</p>}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={cn('mt-1 text-2xs', m.direction === 'INBOUND' ? 'text-muted-foreground' : 'text-primary-foreground/80')}>{m.authorName} · {fmtDateTime(m.createdAt)}{m.direction === 'OUTBOUND' && (m.readAt ? ' · read' : ' · not read yet')}</p>
                </div>
              ))}
            </CardContent>
            {can('communications.send') && (
              <div className="flex gap-2 border-t p-3">
                <Textarea aria-label="Reply" rows={2} value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply… (the client is emailed that a message is waiting)" />
                <Button disabled={!reply.trim()} loading={send.isPending} onClick={() => send.mutate()}><Send /> Send</Button>
              </div>
            )}
          </>
        ) : <EmptyState icon={MessageSquare} title="Choose a conversation" className="my-auto" />}
      </Card>
    </div>
  );
}

function Requests() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['appointment-requests'], queryFn: () => api.get<AppointmentRequestRow[]>('/appointment-requests'), refetchInterval: 30_000 });
  const decline = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/appointment-requests/${id}/decision`, { action: 'declined', reason }),
    onSuccess: () => { toast.success('The client has been told in the portal'); qc.invalidateQueries({ queryKey: ['appointment-requests'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <DataTable
        query={q}
        rowKey={(r) => r.id}
        empty={<EmptyState icon={CalendarPlus} title="No pending requests" description="Clients can request appointments from the portal; they appear here for booking." />}
        columns={[
          { key: 'when', header: 'Requested', cell: (r) => <span className="text-xs">{fmtRelative(r.createdAt)}</span> },
          { key: 'client', header: 'Client', cell: (r) => <span className="text-sm"><Link className="font-medium hover:underline" href={`/clients/${r.client.id}`}>{r.client.displayName}</Link><span className="block text-xs text-muted-foreground">{r.client.mobilePhone ?? r.client.email}</span></span> },
          { key: 'pet', header: 'Animal', cell: (r) => <span className="text-sm">{r.patient ? `${r.patient.name} (${r.patient.species.name})` : '—'}</span> },
          { key: 'reason', header: 'Reason', cell: (r) => <span className="text-sm">{r.reason}{r.notes && <span className="block text-xs text-muted-foreground">{r.notes}</span>}</span> },
          { key: 'pref', header: 'Preferred', cell: (r) => <span className="whitespace-nowrap text-sm">{fmtDate(r.preferredDate)}<span className="block text-xs text-muted-foreground">{enumLabel(r.preferredTime)}</span></span> },
          {
            key: 'act',
            header: '',
            cell: (r) =>
              can('appointments.write') && (
                <span className="flex justify-end gap-1">
                  <Button size="sm" asChild><Link href={`/calendar?request=${r.id}${r.patient ? `&patient=${r.patient.id}` : ''}&date=${r.preferredDate.slice(0, 10)}&reason=${encodeURIComponent(r.reason)}`}>Book</Link></Button>
                  <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Decline this request?', description: 'The client sees your reason in the portal.', requireReason: true, reasonLabel: 'Message to the client', confirmLabel: 'Decline' }); if (c.confirmed) decline.mutate({ id: r.id, reason: c.reason! }); }}>Decline</Button>
                </span>
              ),
          },
        ]}
      />
    </Card>
  );
}

function Communications() {
  const url = useUrlState();
  const portal = usePortalEnabled();
  const tab = portal ? url.get('tab', 'log') : 'log';
  const unread = useQuery({ queryKey: ['client-messages', 'unread'], queryFn: () => api.get<{ unread: number }>('/client-messages/unread'), refetchInterval: 30_000, enabled: portal });
  const requests = useQuery({ queryKey: ['appointment-requests'], queryFn: () => api.get<AppointmentRequestRow[]>('/appointment-requests'), enabled: portal });
  if (!portal) {
    return (
      <>
        <PageHeader title="Communications" help="communications" description="Reminders and messages sent to clients, with their delivery status." />
        <MessageLog />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Communications" help="communications" description="Reminders and messages to clients, secure messages from the client portal, and online appointment requests." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {[['log', 'Message log', 0], ['inbox', 'Client messages', unread.data?.unread ?? 0], ['requests', 'Appointment requests', requests.data?.length ?? 0]].map(([k, l, n]) => (
          <button key={k as string} role="tab" aria-selected={tab === k} onClick={() => url.set({ tab: k as string, client: null })} className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {l}{(n as number) > 0 && <Badge variant="destructive" className="px-1.5 py-0">{n}</Badge>}
          </button>
        ))}
      </div>
      {tab === 'inbox' ? <ClientInbox /> : tab === 'requests' ? <Requests /> : <MessageLog />}
    </>
  );
}

export default function CommunicationsPage() {
  return (
    <RequirePermission anyOf={['communications.read']}>
      <Suspense><Communications /></Suspense>
    </RequirePermission>
  );
}
