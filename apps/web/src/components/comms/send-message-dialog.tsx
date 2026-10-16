'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MESSAGE_CHANNELS, enumLabel } from '@vcms/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import type { OutboundMessage } from '@/lib/types';

/** Compose an email/SMS/WhatsApp message to a client. Delivery is tracked in Communications. */
export function SendMessageDialog({ client, open, onOpenChange }: { client: { id: string; displayName: string; email: string | null; mobilePhone: string | null; preferredChannel?: string }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState('EMAIL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setChannel(client.preferredChannel && ['EMAIL', 'SMS', 'WHATSAPP'].includes(client.preferredChannel) ? client.preferredChannel : 'EMAIL'); setSubject(''); setBody(''); setError(null); }
  }, [open, client.preferredChannel]);
  const recipient = channel === 'EMAIL' ? client.email : client.mobilePhone;
  const m = useMutation({
    mutationFn: () => api.post<OutboundMessage>('/messages', { clientId: client.id, channel, subject: subject || null, body }),
    onSuccess: (r) => {
      toast[r.status === 'SKIPPED' ? 'warning' : 'success'](r.status === 'SKIPPED' ? `Not sent: ${r.lastError}` : 'Message queued for delivery');
      qc.invalidateQueries({ queryKey: ['messages'] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message {client.displayName}</DialogTitle>
          <DialogDescription>Sent from the clinic and recorded in the client’s communication history.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <Field label="Channel" htmlFor="sm-ch" hint={recipient ? `To ${recipient}` : 'No contact details for this channel'}>
          <NativeSelect id="sm-ch" value={channel} onChange={(e) => setChannel(e.target.value)}>{MESSAGE_CHANNELS.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect>
        </Field>
        {channel === 'EMAIL' && <Field label="Subject" htmlFor="sm-subj"><Input id="sm-subj" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></Field>}
        <Field label="Message" htmlFor="sm-body" required hint={channel === 'SMS' ? `${body.length} characters` : undefined}><Textarea id="sm-body" rows={6} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!body.trim()} onClick={() => { setError(null); m.mutate(); }}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
