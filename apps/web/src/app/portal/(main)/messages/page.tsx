'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LoadingRows } from '@/components/page';
import { usePortal } from '@/components/portal/shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { fmtDateTime } from '@/lib/format';
import { portalApi } from '@/lib/portal-api';
import type { ClientMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function PortalMessages() {
  const s = usePortal();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'MESSAGE' | 'FEEDBACK'>('MESSAGE');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['portal', 'messages'], queryFn: () => portalApi.get<ClientMessage[]>('/messages'), refetchInterval: 30_000 });
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [q.data?.length]);
  const send = useMutation({
    mutationFn: () => portalApi.post('/messages', { kind, subject: subject || null, body }),
    onSuccess: () => { setSubject(''); setBody(''); toast.success(kind === 'FEEDBACK' ? 'Thank you for your feedback' : 'Message sent to the clinic'); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!q.data) return <LoadingRows />;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Messages</h1>
        <p className="text-sm text-muted-foreground">A secure conversation with {s.clinic.name}. For anything urgent, please phone{s.clinic.phone ? ` ${s.clinic.phone}` : ' the clinic'}.</p>
      </div>
      <Card className="flex max-h-[55vh] min-h-[240px] flex-col gap-2 overflow-y-auto p-4">
        {q.data.map((m) => (
          <div key={m.id} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.direction === 'INBOUND' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted')}>
            {m.kind === 'FEEDBACK' && <Badge variant="warning" className="mb-1">Feedback</Badge>}
            {m.subject && <p className="font-semibold">{m.subject}</p>}
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className={cn('mt-1 text-2xs', m.direction === 'INBOUND' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{m.direction === 'INBOUND' ? 'You' : m.authorName} · {fmtDateTime(m.createdAt)}</p>
          </div>
        ))}
        {!q.data.length && <p className="m-auto text-sm text-muted-foreground">No messages yet. Ask the clinic a question below.</p>}
        <div ref={end} />
      </Card>
      <Card className="grid gap-2 p-4">
        <div className="flex gap-1" role="radiogroup">
          {(['MESSAGE', 'FEEDBACK'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('rounded-md px-3 py-1 text-sm', kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{k === 'MESSAGE' ? 'Message' : 'Feedback'}</button>
          ))}
        </div>
        <Input aria-label="Subject" placeholder="Subject (optional)" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        <Textarea aria-label="Your message" rows={3} placeholder={kind === 'FEEDBACK' ? 'Tell us how we did…' : 'Write your message…'} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
        <div><Button disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate()}><Send /> Send</Button></div>
      </Card>
    </div>
  );
}
