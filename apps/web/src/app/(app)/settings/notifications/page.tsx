'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WHATSAPP_PURPOSE_LABELS, type ClientNotificationEvent } from '@vcms/shared';
import { AlertTriangle, BellRing, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, CreditCard, FlaskConical, HeartPulse, Link2, Mail, MessageCircle, Syringe, Workflow } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Rule {
  event: ClientNotificationEvent;
  whatsapp: boolean;
  email: boolean;
  updatedByName: string | null;
}
interface Overview {
  rules: Rule[];
  whatsapp: { connected: boolean; active: boolean; linked: string[] };
  email: { own: boolean; address: string | null; provider: string | null; needsAttention: boolean; platformSender: string };
}

const ICONS: Record<ClientNotificationEvent, React.ComponentType<{ className?: string }>> = {
  APPOINTMENT_BOOKED: CalendarCheck,
  APPOINTMENT_RESCHEDULED: CalendarClock,
  APPOINTMENT_CANCELLED: CalendarX,
  LAB_RESULTS_READY: FlaskConical,
  PATIENT_DISCHARGED: HeartPulse,
  PAYMENT_RECEIVED: CreditCard,
  VACCINATION_GIVEN: Syringe,
};

/** WhatsApp's status for these messages, with the one next step when something is missing. */
function WhatsAppStatus({ w, canSetUp }: { w: Overview['whatsapp']; canSetUp: boolean }) {
  const state = w.active ? 'on' : w.connected ? 'paused' : 'off';
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-6">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white', state === 'on' ? 'bg-[#25D366] shadow-[0_8px_20px_-8px_rgba(37,211,102,0.8)]' : 'bg-muted-foreground/40')} aria-hidden>
          <MessageCircle className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold">
            {state === 'on' ? 'Notifications go out on WhatsApp' : state === 'paused' ? 'WhatsApp is connected, but sending is paused' : 'WhatsApp is not connected yet'}
          </p>
          <p className="text-sm text-muted-foreground">
            {state === 'on'
              ? 'Clients with a mobile number get these on WhatsApp; turn on email for clients without WhatsApp.'
              : 'Until it is on, only the notifications with email switched on are sent (to clients with an email address).'}
          </p>
        </div>
        {state !== 'on' && canSetUp && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/settings/integrations/whatsapp">{state === 'paused' ? 'Turn on sending' : 'Connect WhatsApp'}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Where client emails come from: the clinic's own mailbox, or the system address until one is connected. */
function EmailStatus({ e, canSetUp }: { e: Overview['email']; canSetUp: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-6">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white', e.needsAttention ? 'bg-warning' : e.own ? (e.provider === 'GMAIL' ? 'bg-[#EA4335]' : e.provider === 'OUTLOOK' ? 'bg-[#0078D4]' : 'bg-primary') : 'bg-muted-foreground/40')} aria-hidden>
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="font-semibold">{e.needsAttention ? `${e.address} needs attention` : e.own ? `Emails go from ${e.address}` : 'Emails go from the system address'}</p>
          <p className="text-sm text-muted-foreground">
            {e.needsAttention ? `The mailbox stopped working, so emails go from ${e.platformSender} until it is reconnected.` : e.own ? 'Clients see your own address, and their replies come to you.' : `${e.platformSender}, with your clinic’s name. Connect your Gmail or Outlook so emails come from you.`}
          </p>
        </div>
        {canSetUp && (!e.own || e.needsAttention) && (
          <Button asChild variant={e.needsAttention ? 'default' : 'outline'} className="w-full sm:w-auto">
            <Link href="/settings/integrations/email">{e.needsAttention ? 'Reconnect' : 'Connect Gmail / Outlook'}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['client-notifications'], queryFn: () => api.get<Overview>('/client-notifications') });
  const save = useMutation({
    mutationFn: (r: Pick<Rule, 'event' | 'whatsapp' | 'email'>) => api.put<Overview>('/client-notifications', r),
    onSuccess: (r, v) => {
      qc.setQueryData(['client-notifications'], r);
      const title = WHATSAPP_PURPOSE_LABELS[v.event].title;
      toast.success(v.whatsapp || v.email ? `${title}: ${[v.whatsapp && 'WhatsApp', v.email && 'email'].filter(Boolean).join(' and ')}` : `${title}: off`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const canSetUp = can('integrations.manage');
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden>
          <BellRing className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Client notifications</h2>
          <p className="text-sm text-muted-foreground">Messages sent to clients automatically when something happens. Reminders are set up under Reminder messages.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WhatsAppStatus w={d.whatsapp} canSetUp={canSetUp} />
        <EmailStatus e={d.email} canSetUp={canSetUp || can('settings.manage')} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>What clients are told</CardTitle>
            <CardDescription className="mt-1">Choose WhatsApp, email, both or neither for each. Each message is sent once, after the change is saved.</CardDescription>
          </div>
        </CardHeader>
        <div className="hidden grid-cols-[minmax(0,1fr)_96px_96px] gap-4 border-b border-foreground/[0.06] px-6 py-2 text-2xs font-semibold uppercase tracking-[0.07em] text-muted-foreground sm:grid">
          <span>Notification</span>
          <span className="text-center">WhatsApp</span>
          <span className="text-center">Email</span>
        </div>
        <ul className="divide-y divide-foreground/[0.05]">
          {d.rules.map((r) => {
            const Icon = ICONS[r.event];
            const label = WHATSAPP_PURPOSE_LABELS[r.event];
            const linked = d.whatsapp.linked.includes(r.event);
            return (
              <li key={r.event} className="grid gap-3 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_96px_96px] sm:items-center sm:gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-brand-2/15 text-primary ring-1 ring-inset ring-primary/15">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{label.title}</p>
                    <p className="text-sm text-muted-foreground">{label.text}</p>
                    {d.whatsapp.connected && r.whatsapp && (
                      <p className={cn('mt-1 flex items-center gap-1 text-xs', linked ? 'text-success' : 'text-warning')}>
                        {linked ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {linked ? 'WhatsApp template linked' : 'No WhatsApp template yet — only reaches clients who messaged you in the last 24 hours'}
                        {!linked && canSetUp && (
                          <Link href="/settings/integrations/whatsapp" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                            <Link2 className="h-3 w-3" /> Link one
                          </Link>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <label className="flex items-center justify-between gap-2 sm:justify-center">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </span>
                  <Switch checked={r.whatsapp} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ event: r.event, whatsapp: v, email: r.email })} aria-label={`${label.title} on WhatsApp`} />
                </label>
                <label className="flex items-center justify-between gap-2 sm:justify-center">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground sm:hidden">
                    <Mail className="h-4 w-4" /> Email
                  </span>
                  <Switch checked={r.email} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ event: r.event, whatsapp: r.whatsapp, email: v })} aria-label={`${label.title} by email`} />
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/[0.06] px-6 py-4 text-sm text-muted-foreground">
          <span>A client who asked for email gets email when it is switched on; otherwise WhatsApp comes first. A death in hospital is never sent automatically.</span>
          {can('settings.manage') && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/automations">Automations</Link>
            </Button>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gradient-to-br from-primary/[0.08] to-brand-2/[0.08] p-5 ring-1 ring-inset ring-primary/15">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-2 text-white">
          <Workflow className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-semibold">Need more than these?</p>
          <p className="text-sm text-muted-foreground">Build your own: a thank-you after each visit, a check-up call after discharge, birthday wishes, “we missed you”… with waits, conditions and tasks for staff.</p>
        </div>
        <Button asChild>
          <Link href="/settings/automations">Open Automations</Link>
        </Button>
      </div>
    </div>
  );
}

export default function ClientNotificationsPage() {
  return (
    <RequirePermission anyOf={['settings.manage', 'integrations.manage']}>
      <Notifications />
    </RequirePermission>
  );
}
