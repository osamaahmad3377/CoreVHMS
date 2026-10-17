'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MESSAGE_PURPOSES, enumLabel, type Paginated } from '@vcms/shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { usePortalEnabled } from '@/lib/session';
import type { MessageTemplate, OutboundMessage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Settings { reminderLeadDays: number; overdueReminderDays: number; appointmentReminderHours: number; portalEnabled: boolean; portalCancelHours: number }

const PLACEHOLDERS: Record<string, string> = {
  CARE_REMINDER: '{{clientName}} {{petNames}} {{items}} {{itemsShort}} {{clinicName}} {{clinicPhoneLine}}',
  CARE_OVERDUE: '{{clientName}} {{petNames}} {{items}} {{itemsShort}} {{clinicName}} {{clinicPhoneLine}}',
  APPOINTMENT_REMINDER: '{{clientName}} {{petName}} {{appointmentType}} {{appointmentTime}} {{clinicName}} {{clinicPhoneLine}}',
  PORTAL_INVITE: '{{clientName}} {{clinicName}} {{link}}',
  PORTAL_RESET: '{{clientName}} {{link}}',
  GENERAL: '{{body}} {{clientName}} {{clinicName}}',
};

/** Plain names for the placeholders, shown on the Insert buttons. */
const PLACEHOLDER_LABELS: Record<string, string> = {
  clientName: 'Client name', petNames: 'Pet names', petName: 'Pet name', items: 'What is due', itemsShort: 'What is due (short)',
  clinicName: 'Clinic name', clinicPhoneLine: 'Clinic phone', appointmentType: 'Appointment type', appointmentTime: 'Appointment time',
  link: 'Link', body: 'Your message',
};
const placeholderList = (purpose: string) => (PLACEHOLDERS[purpose] ?? '').split(' ').filter(Boolean).map((p) => p.replace(/[{}]/g, ''));

function TemplateEditor({ t }: { t: MessageTemplate }) {
  const qc = useQueryClient();
  const area = useRef<HTMLTextAreaElement>(null);
  /** Puts {{name}} where the cursor is, so owners do not have to type braces. */
  const insert = (name: string) => {
    const el = area.current;
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + token.length, start + token.length); } });
  };
  const [subject, setSubject] = useState(t.subject ?? '');
  const [body, setBody] = useState(t.body);
  const [active, setActive] = useState(t.isActive);
  useEffect(() => { setSubject(t.subject ?? ''); setBody(t.body); setActive(t.isActive); }, [t]);
  const dirty = subject !== (t.subject ?? '') || body !== t.body || active !== t.isActive;
  const m = useMutation({
    mutationFn: () => api.put('/message-templates', { purpose: t.purpose, channel: t.channel, subject: subject || null, body, isActive: active }),
    onSuccess: () => { toast.success('Template saved'); qc.invalidateQueries({ queryKey: ['message-templates'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline">{enumLabel(t.channel)}</Badge>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">Active <Switch checked={active} onCheckedChange={setActive} aria-label={`${t.purpose} ${t.channel} active`} /></label>
      </div>
      {t.channel === 'EMAIL' && <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />}
      <div role="group" aria-label="Insert a detail" className="flex flex-wrap items-center gap-1">
        <span className="text-2xs text-muted-foreground">Insert:</span>
        {placeholderList(t.purpose).map((name) => (
          <Button key={name} type="button" size="sm" variant="outline" className="h-6 px-2 text-2xs" onClick={() => insert(name)} title={`Adds {{${name}}}`}>{PLACEHOLDER_LABELS[name] ?? name}</Button>
        ))}
      </div>
      <Textarea ref={area} aria-label="Message" rows={t.channel === 'EMAIL' ? 6 : 3} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">{t.channel !== 'EMAIL' && `${body.length} characters · `}{t.updatedByName ? `Edited by ${t.updatedByName}` : 'Default wording'}</span>
        <Button size="sm" disabled={!dirty || !body.trim()} loading={m.isPending} onClick={() => m.mutate()}>Save</Button>
      </div>
    </div>
  );
}

export default function CommunicationsSettingsPage() {
  const qc = useQueryClient();
  const portal = usePortalEnabled();
  const purposes = MESSAGE_PURPOSES.filter((p) => portal || !p.startsWith('PORTAL_'));
  const settings = useQuery({ queryKey: ['comms-settings'], queryFn: () => api.get<Settings>('/communications/settings') });
  const templates = useQuery({ queryKey: ['message-templates'], queryFn: () => api.get<MessageTemplate[]>('/message-templates') });
  const channels = useQuery({ queryKey: ['messages', 'channels'], queryFn: () => api.get<Paginated<OutboundMessage> & { channels: { channel: string; configured: boolean; provider: string }[] }>('/messages?pageSize=1') });
  const [f, setF] = useState<Record<string, string>>({});
  const [purpose, setPurpose] = useState<string>('CARE_REMINDER');
  useEffect(() => { if (settings.data) setF({ reminderLeadDays: String(settings.data.reminderLeadDays), overdueReminderDays: String(settings.data.overdueReminderDays), appointmentReminderHours: String(settings.data.appointmentReminderHours), portalCancelHours: String(settings.data.portalCancelHours) }); }, [settings.data]);
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>('/communications/settings', { ...settings.data, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])), ...patch }),
    onSuccess: (d) => { qc.setQueryData(['comms-settings'], d); toast.success('Saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const s = settings.data;
  return (
    <RequirePermission anyOf={['settings.manage']}>
      <div className="grid gap-4">
        <Card>
          <CardHeader><div><CardTitle>Reminders</CardTitle><CardDescription>Reminders are generated every hour and only sent to clients who have not opted out.</CardDescription></div></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field label="Care reminder (days before due)" htmlFor="cs-lead"><Input id="cs-lead" inputMode="numeric" value={f.reminderLeadDays ?? ''} onChange={(e) => setF({ ...f, reminderLeadDays: e.target.value })} /></Field>
            <Field label="Overdue notice (days after due)" htmlFor="cs-over"><Input id="cs-over" inputMode="numeric" value={f.overdueReminderDays ?? ''} onChange={(e) => setF({ ...f, overdueReminderDays: e.target.value })} /></Field>
            <Field label="Appointment reminder (hours before)" htmlFor="cs-appt"><Input id="cs-appt" inputMode="numeric" value={f.appointmentReminderHours ?? ''} onChange={(e) => setF({ ...f, appointmentReminderHours: e.target.value })} /></Field>
            <div className="sm:col-span-3"><Button size="sm" disabled={!s} loading={save.isPending} onClick={() => save.mutate({})}>Save reminder timing</Button></div>
          </CardContent>
        </Card>
        {portal && (
          <Card>
            <CardHeader><div><CardTitle>Client portal</CardTitle><CardDescription>Clients you invite can see their animals’ vaccinations, released results, discharge notes, appointments and invoices, and message the clinic.</CardDescription></div></CardHeader>
            <CardContent className="grid gap-3">
              <label className="flex items-center justify-between gap-3 text-sm">Portal switched on <Switch checked={!!s?.portalEnabled} disabled={!s} onCheckedChange={(v) => save.mutate({ portalEnabled: v })} aria-label="Portal switched on" /></label>
              <div className="flex items-end gap-2">
                <Field label="Online cancellation allowed until (hours before)" htmlFor="cs-cancel"><Input id="cs-cancel" className="w-32" inputMode="numeric" value={f.portalCancelHours ?? ''} onChange={(e) => setF({ ...f, portalCancelHours: e.target.value })} /></Field>
                <Button size="sm" variant="outline" onClick={() => save.mutate({})}>Save</Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><div><CardTitle>Channels</CardTitle><CardDescription>Messages on channels without a provider are recorded as “Not sent”; reminders fall back to email when possible.</CardDescription></div></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {(channels.data?.channels ?? []).map((c) => (
              <div key={c.channel} className="rounded-md border px-3 py-2 text-sm"><b>{enumLabel(c.channel)}</b> <Badge variant={c.configured ? 'success' : 'secondary'} className="ml-1">{c.configured ? `Connected (${c.provider})` : 'Not connected'}</Badge></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle>Message wording</CardTitle><CardDescription>Use the Insert buttons to add the client’s name, pet name and other details. They are filled in when the message is sent.</CardDescription></div></CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex flex-wrap gap-1" role="tablist">
              {purposes.map((p) => (
                <button key={p} role="tab" aria-selected={purpose === p} onClick={() => setPurpose(p)} className={cn('rounded-md px-3 py-1.5 text-sm', purpose === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>{enumLabel(p, 'message')}</button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {(templates.data ?? []).filter((t) => t.purpose === purpose).map((t) => <TemplateEditor key={t.id} t={t} />)}
            </div>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
