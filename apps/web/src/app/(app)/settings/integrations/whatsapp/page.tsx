'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WHATSAPP_PURPOSE_LABELS, WHATSAPP_PURPOSES, type WhatsAppPurpose } from '@vcms/shared';
import { AlertTriangle, BellRing, CheckCheck, ChevronRight, CheckCircle2, ExternalLink, Eye, EyeOff, Link2, MessageCircle, PlugZap, RefreshCw, Send, ShieldCheck, Unplug, Webhook, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { WhatsAppTemplateDialog } from '@/components/integrations/whatsapp-template-dialog';
import { ErrorState, LoadingRows } from '@/components/page';
import { CopyButton } from '@/components/platform/clinic-ui';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { WhatsAppOverview } from '@/lib/types';
import { cn } from '@/lib/utils';

const WA_GREEN = 'bg-[#25D366]';

/** The WhatsApp mark in its brand green, used for the connection header. */
function WhatsAppMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_20px_-8px_rgba(37,211,102,0.8)]', WA_GREEN, className)} aria-hidden>
      <MessageCircle className="h-6 w-6" strokeWidth={2} />
    </span>
  );
}

const QUALITY: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  GREEN: { label: 'Quality: high', variant: 'success' },
  YELLOW: { label: 'Quality: medium', variant: 'warning' },
  RED: { label: 'Quality: low', variant: 'destructive' },
};

/** Phone number ID, account ID, token and app secret: connect, or update the saved connection. */
function ConnectForm({ data, onDone }: { data?: WhatsAppOverview; onDone?: () => void }) {
  const qc = useQueryClient();
  const editing = !!data?.connected;
  const [f, setF] = useState({ phoneNumberId: data?.phoneNumberId ?? '', businessAccountId: data?.businessAccountId ?? '', accessToken: '', appSecret: '' });
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errs = {
    phoneNumberId: /^\d{6,25}$/.test(f.phoneNumberId.trim()) ? undefined : 'A long number, from WhatsApp Manager → API setup',
    businessAccountId: /^\d{6,25}$/.test(f.businessAccountId.trim()) ? undefined : 'A long number, from WhatsApp Manager → API setup',
    accessToken: editing && !f.accessToken ? undefined : f.accessToken.trim().length >= 20 ? undefined : 'Paste the permanent access token',
  };
  const m = useMutation({
    mutationFn: () => api.put<WhatsAppOverview>('/integrations/whatsapp', { ...f, phoneNumberId: f.phoneNumberId.trim(), businessAccountId: f.businessAccountId.trim() }),
    onSuccess: (r) => {
      toast.success(editing ? 'Connection updated' : `Connected to ${r.verifiedName ?? r.displayPhoneNumber ?? 'WhatsApp'}`);
      qc.setQueryData(['whatsapp'], r);
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        setError(null);
        if (!Object.values(errs).some(Boolean)) m.mutate();
      }}
    >
      {error && <FormError message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number ID" htmlFor="wa-pn" required error={tried ? errs.phoneNumberId : undefined}>
          <Input id="wa-pn" inputMode="numeric" autoComplete="off" placeholder="e.g. 106540352242922" value={f.phoneNumberId} onChange={set('phoneNumberId')} aria-invalid={tried && !!errs.phoneNumberId} />
        </Field>
        <Field label="Business Account ID" htmlFor="wa-waba" required error={tried ? errs.businessAccountId : undefined}>
          <Input id="wa-waba" inputMode="numeric" autoComplete="off" placeholder="e.g. 102290129340398" value={f.businessAccountId} onChange={set('businessAccountId')} aria-invalid={tried && !!errs.businessAccountId} />
        </Field>
      </div>
      <Field
        label="Permanent access token"
        htmlFor="wa-token"
        required={!editing}
        hint={editing ? 'Leave empty to keep the saved token.' : 'From a System User in Meta Business settings, with whatsapp_business_messaging and whatsapp_business_management. Stored encrypted.'}
        error={tried ? errs.accessToken : undefined}
      >
        <div className="flex gap-2">
          <Input id="wa-token" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={editing ? '•••••••• (saved)' : 'EAAG…'} value={f.accessToken} onChange={set('accessToken')} aria-invalid={tried && !!errs.accessToken} />
          <Button type="button" variant="outline" size="icon" aria-label={show ? 'Hide token' : 'Show token'} onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </Field>
      <Field
        label="App secret (recommended)"
        htmlFor="wa-secret"
        hint={editing && data?.hasAppSecret ? 'Saved. Leave empty to keep it.' : 'From your Meta app → App settings → Basic. Lets us check that delivery updates really come from Meta.'}
      >
        <Input id="wa-secret" type="password" autoComplete="off" spellCheck={false} value={f.appSecret} onChange={set('appSecret')} />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onDone && editing && (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={m.isPending}>
          <PlugZap /> {editing ? 'Check and save' : 'Connect WhatsApp'}
        </Button>
      </div>
    </form>
  );
}

const STEPS = [
  { title: 'Create a WhatsApp Business app', text: 'In Meta for Developers, create an app of type “Business” and add the WhatsApp product.', href: 'https://developers.facebook.com/apps' },
  { title: 'Add your clinic’s number', text: 'In WhatsApp Manager → API setup, add and verify the clinic’s phone number. Copy its Phone number ID and the WhatsApp Business Account ID.', href: 'https://business.facebook.com/wa/manage/home/' },
  { title: 'Create a permanent token', text: 'Meta Business settings → System users: add one, give it the app and WhatsApp account, and generate a token with whatsapp_business_messaging and whatsapp_business_management.', href: 'https://business.facebook.com/settings/system-users' },
  { title: 'Paste them here', text: 'We check them with Meta before saving. Nothing is sent until you switch sending on.' },
];

function NotConnected() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Connect your WhatsApp Business number</CardTitle>
            <CardDescription className="mt-1">Uses Meta’s official WhatsApp Business Platform (Cloud API). Your number, your account — clients see your clinic’s name.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ConnectForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>How to get these</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-inset ring-primary/20">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="text-sm text-muted-foreground">{s.text}</p>
                  {s.href && (
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone?: string }) {
  return (
    <div className="surface-flat flex items-center gap-3 rounded-xl p-4">
      <Icon className={cn('h-5 w-5 shrink-0', tone ?? 'text-muted-foreground')} />
      <div>
        <p className="text-xl font-semibold leading-none tabular">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function Connected({ data }: { data: WhatsAppOverview }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState<WhatsAppPurpose | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testPurpose, setTestPurpose] = useState('');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = data.webhookPath ? `${origin}${data.webhookPath}` : '';

  const settings = useMutation({
    mutationFn: (body: Partial<Pick<WhatsAppOverview, 'enabled' | 'sendPolicy' | 'fallbackToEmail'>>) => api.patch<WhatsAppOverview>('/integrations/whatsapp/settings', body),
    onSuccess: (r, v) => {
      qc.setQueryData(['whatsapp'], r);
      if (v.enabled !== undefined) toast.success(v.enabled ? 'WhatsApp sending is on' : 'WhatsApp sending is paused');
      else toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const verify = useMutation({
    mutationFn: () => api.post<WhatsAppOverview>('/integrations/whatsapp/verify'),
    onSuccess: (r) => {
      qc.setQueryData(['whatsapp'], r);
      toast.success('Connection is working');
    },
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ to: string; template: string }>('/integrations/whatsapp/test', { to: testTo, purpose: testPurpose || undefined }),
    onSuccess: (r) => toast.success(`Test sent to +${r.to} (${r.template}). Check the phone.`),
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api.del<WhatsAppOverview>('/integrations/whatsapp'),
    onSuccess: (r) => {
      qc.setQueryData(['whatsapp'], r);
      toast.success('WhatsApp disconnected');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quality = data.qualityRating ? QUALITY[data.qualityRating] : undefined;
  const unlinked = WHATSAPP_PURPOSES.filter((p) => p !== 'GENERAL' && !data.links.some((l) => l.purpose === p));
  const s = data.last30Days;

  return (
    <div className="grid gap-6">
      {/* Connection header */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-6">
          <WhatsAppMark />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{data.verifiedName ?? 'WhatsApp Business'}</h2>
              {data.enabled ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3 w-3" /> Sending
                </Badge>
              ) : (
                <Badge variant="warning">Connected · sending paused</Badge>
              )}
              {quality && <Badge variant={quality.variant}>{quality.label}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {data.displayPhoneNumber ?? `Phone number ID ${data.phoneNumberId}`}
              {data.lastVerifiedAt && ` · checked ${fmtDateTime(data.lastVerifiedAt)}`}
              {data.connectedByName && ` · connected by ${data.connectedByName}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}>
              <RefreshCw /> Check connection
            </Button>
            <Button variant="outline" onClick={() => setEditing((e) => !e)}>
              Edit details
            </Button>
          </div>
        </div>
        {data.lastError && (
          <div className="flex items-start gap-3 border-t border-destructive/20 bg-destructive/[0.06] px-6 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{data.lastError}</span>
          </div>
        )}
        {editing && (
          <div className="border-t border-foreground/[0.06] p-6">
            <ConnectForm data={data} onDone={() => setEditing(false)} />
          </div>
        )}
      </Card>

      {/* Last 30 days */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Sent (30 days)" value={s.sent} icon={Send} tone="text-primary" />
        <Figure label="Delivered" value={s.delivered} icon={CheckCheck} tone="text-muted-foreground" />
        <Figure label="Read" value={s.read} icon={CheckCheck} tone="text-[#53bdeb]" />
        <Figure label="Not delivered" value={s.failed} icon={XCircle} tone={s.failed ? 'text-destructive' : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Sending rules */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sending</CardTitle>
              <CardDescription className="mt-1">Reminders and messages to clients go out on WhatsApp by these rules.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold">Send by WhatsApp</span>
                <span className="block text-sm text-muted-foreground">Appointment reminders, vaccination reminders and staff messages.</span>
              </span>
              <Switch checked={data.enabled} disabled={settings.isPending} onCheckedChange={(v) => settings.mutate({ enabled: v })} aria-label="Send by WhatsApp" />
            </label>
            <div className="grid gap-2" role="radiogroup" aria-label="Who gets WhatsApp messages">
              <span className="text-sm font-semibold">Who gets WhatsApp messages</span>
              {(
                [
                  ['PREFERRED', 'Clients who chose WhatsApp', 'Their contact preference on the client record says WhatsApp.'],
                  ['ALL_MOBILE', 'Every client with a mobile number', 'Unless they chose email. Recommended once your templates are approved.'],
                ] as const
              ).map(([v, title, text]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={data.sendPolicy === v}
                  onClick={() => data.sendPolicy !== v && settings.mutate({ sendPolicy: v })}
                  className={cn('flex items-start gap-3 rounded-xl surface-flat p-3 text-left transition-colors', data.sendPolicy === v && 'border-primary/50 bg-primary/[0.06] ring-1 ring-primary/30')}
                >
                  <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', data.sendPolicy === v ? 'border-primary' : 'border-foreground/30')}>
                    {data.sendPolicy === v && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{text}</span>
                  </span>
                </button>
              ))}
            </div>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold">If WhatsApp can’t deliver, send by email</span>
                <span className="block text-sm text-muted-foreground">For clients with an email address, using your email wording.</span>
              </span>
              <Switch checked={data.fallbackToEmail} disabled={settings.isPending} onCheckedChange={(v) => settings.mutate({ fallbackToEmail: v })} aria-label="Fall back to email" />
            </label>
            <Link href="/settings/notifications" className="group flex items-center gap-3 rounded-xl surface-flat p-3 transition-colors hover:bg-[hsl(var(--glass)/0.85)]">
              <BellRing className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Client notifications</span>
                <span className="block text-xs text-muted-foreground">Booking confirmed, appointment moved, results ready, payment received… choose which go out.</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </CardContent>
        </Card>

        {/* Templates */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Message templates</CardTitle>
              <CardDescription className="mt-1">WhatsApp only lets a business start a conversation with a Meta-approved template. Link one to each kind of message.</CardDescription>
            </div>
          </CardHeader>
          <ul className="divide-y divide-foreground/[0.05]">
            {WHATSAPP_PURPOSES.map((p) => {
              const link = data.links.find((l) => l.purpose === p);
              return (
                <li key={p} className="flex flex-wrap items-center gap-3 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{WHATSAPP_PURPOSE_LABELS[p].title}</p>
                    {link ? (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Link2 className="h-3 w-3" /> {link.templateName} · {link.language}
                        {link.params.length ? ` · ${link.params.length} value${link.params.length === 1 ? '' : 's'}` : ''}
                      </p>
                    ) : (
                      <p className={cn('text-xs', p === 'GENERAL' ? 'text-muted-foreground' : 'text-warning')}>
                        {p === 'GENERAL' ? 'Plain text — reaches clients who messaged you in the last 24 hours' : 'Not linked — will not reach clients who haven’t messaged you in 24 hours'}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant={link ? 'ghost' : 'outline'} onClick={() => setLinking(p)}>
                    {link ? 'Change' : 'Choose template'}
                  </Button>
                </li>
              );
            })}
          </ul>
          {unlinked.length > 0 && (
            <p className="flex items-start gap-2 border-t border-foreground/[0.06] px-6 py-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> Create “Utility” templates in WhatsApp Manager (for example: “Hi {'{{1}}'}, {'{{2}}'} has an appointment at {'{{3}}'} on {'{{4}}'}.”). Meta usually approves them within minutes.
            </p>
          )}
        </Card>

        {/* Webhook */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" /> Delivery updates and replies
              </CardTitle>
              <CardDescription className="mt-1">So you can see “delivered” and “read”, and clients’ replies arrive in Messages.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
              <li>Meta app → WhatsApp → Configuration → Webhook → Edit.</li>
              <li>Paste the address and the verify token below, then Verify and save.</li>
              <li>Under Webhook fields, subscribe to “messages”.</li>
            </ol>
            <Field label="Callback address" htmlFor="wa-hook">
              <div className="flex gap-2">
                <Input id="wa-hook" readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <CopyButton text={webhookUrl} what="Callback address" variant="outline" size="sm" label="Copy" />
              </div>
            </Field>
            <Field label="Verify token" htmlFor="wa-verify">
              <div className="flex gap-2">
                <Input id="wa-verify" readOnly value={data.verifyToken ?? ''} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <CopyButton text={data.verifyToken ?? ''} what="Verify token" variant="outline" size="sm" label="Copy" />
              </div>
            </Field>
            <p className={cn('flex items-center gap-2 text-sm', data.lastWebhookAt ? 'text-success' : 'text-muted-foreground')}>
              {data.lastWebhookAt ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
              {data.lastWebhookAt ? `Last update from Meta ${fmtDateTime(data.lastWebhookAt)}` : 'No updates received from Meta yet'}
            </p>
            {!data.hasAppSecret && <p className="text-xs text-warning">Add your app secret under Edit details so updates can be checked as really coming from Meta.</p>}
          </CardContent>
        </Card>

        {/* Test */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Send a test</CardTitle>
              <CardDescription className="mt-1">To your own phone, to see exactly what clients receive.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (testTo.trim()) test.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mobile number" htmlFor="wa-test-to" hint="With country code, or as you would dial it locally.">
                  <Input id="wa-test-to" type="tel" inputMode="tel" placeholder="0300 1234567" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                </Field>
                <Field label="Message" htmlFor="wa-test-what">
                  <NativeSelect id="wa-test-what" value={testPurpose} onChange={(e) => setTestPurpose(e.target.value)}>
                    <option value="">Meta’s “hello_world” test</option>
                    {data.links.map((l) => (
                      <option key={l.purpose} value={l.purpose}>
                        {WHATSAPP_PURPOSE_LABELS[l.purpose as WhatsAppPurpose]?.title ?? l.purpose} ({l.templateName})
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="outline" disabled={!testTo.trim()} loading={test.isPending}>
                  <Send /> Send test
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl surface-flat px-5 py-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" /> The access token and app secret are stored encrypted and never shown again.
        </p>
        <Button
          variant="ghost"
          className="text-destructive"
          loading={disconnect.isPending}
          onClick={async () => {
            const r = await confirm({ title: 'Disconnect WhatsApp?', description: 'Reminders and messages will go by email (or not be sent) until you connect again. The message history stays.', confirmLabel: 'Disconnect', destructive: true });
            if (r.confirmed) disconnect.mutate();
          }}
        >
          <Unplug /> Disconnect
        </Button>
      </div>

      <WhatsAppTemplateDialog purpose={linking} current={data.links.find((l) => l.purpose === linking)} open={!!linking} onOpenChange={(o) => !o && setLinking(null)} />
    </div>
  );
}

function WhatsAppSettings() {
  // Refreshed every minute while connected, so delivery figures and Meta's updates show up.
  const q = useQuery({ queryKey: ['whatsapp'], queryFn: () => api.get<WhatsAppOverview>('/integrations/whatsapp'), refetchInterval: (query) => (query.state.data?.connected ? 60_000 : false) });
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <WhatsAppMark className="h-10 w-10 rounded-xl" />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">WhatsApp</h2>
          <p className="text-sm text-muted-foreground">Send appointment and vaccination reminders and messages from your clinic’s own WhatsApp Business number.</p>
        </div>
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data!.connected ? <Connected data={q.data!} /> : <NotConnected />}
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  return (
    <RequirePermission anyOf={['integrations.manage']}>
      <WhatsAppSettings />
    </RequirePermission>
  );
}
