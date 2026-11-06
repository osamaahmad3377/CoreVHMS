'use client';
import { useMutation } from '@tanstack/react-query';
import { Mail, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** “Send to the owner” by email or WhatsApp — the message goes through the normal queue and delivery log. */
export function SendToOwner({ path, size = 'sm' }: { path: string; size?: 'sm' | 'default' }) {
  const { can } = useSession();
  const send = useMutation({
    mutationFn: (channel: 'EMAIL' | 'WHATSAPP') => api.post<{ status: string; channel: string }>(path, { channel }),
    onSuccess: (r) =>
      r.status === 'SKIPPED'
        ? toast.warning(r.channel === 'EMAIL' ? 'Not sent — the owner has no email address on file' : 'Not sent — the owner has no WhatsApp number on file, or WhatsApp is not connected')
        : toast.success(r.channel === 'EMAIL' ? 'Email on its way to the owner' : 'WhatsApp message on its way to the owner'),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!can('communications.send')) return null;
  return (
    <>
      <Button variant="outline" size={size} loading={send.isPending && send.variables === 'EMAIL'} disabled={send.isPending} onClick={() => send.mutate('EMAIL')}><Mail /> Email owner</Button>
      <Button variant="outline" size={size} loading={send.isPending && send.variables === 'WHATSAPP'} disabled={send.isPending} onClick={() => send.mutate('WHATSAPP')}><MessageCircle /> WhatsApp owner</Button>
    </>
  );
}
