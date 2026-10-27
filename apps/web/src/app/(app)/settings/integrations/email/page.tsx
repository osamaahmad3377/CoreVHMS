'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMAIL_SMTP_PRESETS, hasFeature, type EmailProvider } from '@vcms/shared';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, LogIn, Mail, Send, Server, ShieldCheck, Unplug, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { UpgradeCard } from '@/components/plan/upgrade';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Connection {
  provider: EmailProvider;
  providerName: string;
  method: 'OAUTH' | 'PASSWORD';
  email: string;
  fromName: string | null;
  isActive: boolean;
  status: 'CONNECTED' | 'NEEDS_ATTENTION';
  smtpHost: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSentAt: string | null;
  sentCount: number;
  connectedByName: string | null;
  connectedAt: string;
}
interface Overview {
  connection: Connection | null;
  signIn: { GMAIL: boolean; OUTLOOK: boolean };
  platformSender: string;
}

const PROVIDERS: { id: EmailProvider; name: string; text: string; color: string }[] = [
  { id: 'GMAIL', name: 'Gmail', text: 'Gmail or Google Workspace', color: 'bg-[#EA4335]' },
  { id: 'OUTLOOK', name: 'Outlook', text: 'Outlook.com or Microsoft 365', color: 'bg-[#0078D4]' },
  { id: 'SMTP', name: 'Other email', text: 'Your website’s or another provider’s mailbox', color: 'bg-foreground/60' },
];

function ProviderMark({ provider, className }: { provider: EmailProvider; className?: string }) {
  const p = PROVIDERS.find((x) => x.id === provider)!;
  const Icon = provider === 'SMTP' ? Server : Mail;
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm', p.color, className)} aria-hidden>
      <Icon className="h-6 w-6" />
    </span>
  );
}

const HELP: Record<'GMAIL' | 'OUTLOOK', { steps: string[]; link: string; linkText: string }> = {
  GMAIL: {
    steps: ['Sign in to the Google account you send from.', 'Turn on 2-Step Verification (Security).', 'Open App passwords, name it “Clinic”, and copy the 16-letter password.'],
    link: 'https://myaccount.google.com/apppasswords',
    linkText: 'Open Google app passwords',
  },
  OUTLOOK: {
    steps: ['Sign in to the Microsoft account you send from.', 'Turn on two-step verification (Security).', 'Create an app password and copy it. Business accounts: your IT person may need to allow SMTP sending.'],
    link: 'https://account.live.com/proofs/AppPassword',
    linkText: 'Open Microsoft app passwords',
  },
};

/** App password (Gmail/Outlook) or full server details (other mailboxes). */
function PasswordForm({ provider, onDone }: { provider: EmailProvider; onDone: () => void }) {
  const qc = useQueryClient();
  const other = provider === 'SMTP';
  const [f, setF] = useState({ email: '', fromName: '', password: '', host: '', port: '587', security: 'STARTTLS', username: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () =>
      api.put<Overview>('/integrations/email/password', {
        provider,
        email: f.email.trim(),
        fromName: f.fromName.trim() || null,
        password: f.password.replace(provider === 'GMAIL' ? /\s+/g : /$^/, ''),
        ...(other ? { host: f.host.trim(), port: Number(f.port), secure: f.security === 'SSL', username: f.username.trim() || null } : {}),
      }),
    onSuccess: (r) => {
      qc.setQueryData(['email-integration'], r);
      toast.success(`Connected — client emails now go from ${r.connection?.email}`);
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const valid = /\S+@\S+\.\S+/.test(f.email) && f.password.length > 0 && (!other || f.host.trim().length > 2);
  const preset = !other ? EMAIL_SMTP_PRESETS[provider] : null;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (valid) m.mutate();
      }}
    >
      {error && <FormError message={error} />}
      {!other && (
        <div className="rounded-xl bg-foreground/[0.03] p-4 text-sm">
          <p className="mb-2 flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4 text-primary" /> Get an app password (2 minutes)
          </p>
          <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
            {HELP[provider as 'GMAIL' | 'OUTLOOK'].steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <a href={HELP[provider as 'GMAIL' | 'OUTLOOK'].link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            {HELP[provider as 'GMAIL' | 'OUTLOOK'].linkText} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" htmlFor="em-a" required>
          <Input id="em-a" type="email" autoComplete="off" placeholder={provider === 'GMAIL' ? 'clinic@gmail.com' : provider === 'OUTLOOK' ? 'clinic@outlook.com' : 'info@yourclinic.com'} value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Sender name clients see" htmlFor="em-n" hint="Leave empty to use your clinic’s name">
          <Input id="em-n" placeholder="e.g. Happy Paws Clinic" value={f.fromName} onChange={set('fromName')} />
        </Field>
        <Field label={other ? 'Password' : 'App password'} htmlFor="em-p" required>
          <div className="relative">
            <Input id="em-p" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={provider === 'GMAIL' ? 'abcd efgh ijkl mnop' : ''} value={f.password} onChange={set('password')} className="pr-10" />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {other && (
          <Field label="User name" htmlFor="em-u" hint="Usually the email address">
            <Input id="em-u" autoComplete="off" value={f.username} onChange={set('username')} />
          </Field>
        )}
      </div>
      {other ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Outgoing (SMTP) server" htmlFor="em-h" required>
            <Input id="em-h" placeholder="mail.yourclinic.com" value={f.host} onChange={set('host')} />
          </Field>
          <Field label="Port" htmlFor="em-port">
            <Input id="em-port" inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, ''), security: e.target.value === '465' ? 'SSL' : f.security })} />
          </Field>
          <Field label="Security" htmlFor="em-sec">
            <NativeSelect id="em-sec" value={f.security} onChange={set('security')}>
              <option value="STARTTLS">STARTTLS (usually port 587)</option>
              <option value="SSL">SSL/TLS (usually port 465)</option>
            </NativeSelect>
          </Field>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Server: {preset!.host}, port {preset!.port}. The password is stored encrypted and only used to send your clinic’s emails.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={m.isPending} disabled={!valid}>
          <ShieldCheck /> Check and connect
        </Button>
      </div>
    </form>
  );
}

/** Choose Gmail / Outlook / other, then sign in or enter an app password. */
function Connect({ d, onCancel }: { d: Overview; onCancel?: () => void }) {
  const [provider, setProvider] = useState<EmailProvider | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const signIn = useMutation({
    mutationFn: (p: 'GMAIL' | 'OUTLOOK') => api.post<{ url: string }>('/integrations/email/sign-in', { provider: p }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!provider) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Which email do you use?</CardTitle>
            <CardDescription className="mt-1">Connect the mailbox your clinic already uses. Clients then get emails from your own address, and their replies come back to you.</CardDescription>
          </div>
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" onClick={() => setProvider(p.id)} className="flex items-center gap-3 rounded-2xl surface-flat p-4 text-left transition-colors hover:border-primary hover:bg-primary/5">
              <ProviderMark provider={p.id} className="h-10 w-10" />
              <span>
                <span className="block font-semibold">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.text}</span>
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
    );
  }
  const oauth = provider !== 'SMTP' && d.signIn[provider];
  const name = PROVIDERS.find((p) => p.id === provider)!.name;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <ProviderMark provider={provider} className="h-10 w-10" />
          <div>
            <CardTitle>Connect {name}</CardTitle>
            <CardDescription className="mt-1">{provider === 'SMTP' ? 'Your email provider or web host gives these details.' : oauth ? 'Sign in and allow sending — the quickest way.' : 'Connect with an app password.'}</CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setProvider(null); setUsePassword(false); }}>
          <ArrowLeft /> Back
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5">
        {oauth && !usePassword && (
          <div className="grid gap-3 rounded-2xl bg-foreground/[0.03] p-5 text-center">
            <Button size="lg" className="mx-auto w-full max-w-sm" loading={signIn.isPending} onClick={() => signIn.mutate(provider as 'GMAIL' | 'OUTLOOK')}>
              <LogIn /> Sign in with {provider === 'GMAIL' ? 'Google' : 'Microsoft'}
            </Button>
            <p className="text-xs text-muted-foreground">You choose the account and allow “send email on your behalf”. We never read your inbox.</p>
            <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setUsePassword(true)}>
              Use an app password instead
            </button>
          </div>
        )}
        {(!oauth || usePassword) && <PasswordForm provider={provider} onDone={() => setProvider(null)} />}
      </CardContent>
    </Card>
  );
}

function Connected({ d }: { d: Overview & { connection: Connection } }) {
  const c = d.connection;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { session } = useSession();
  const [fromName, setFromName] = useState(c.fromName ?? '');
  const [to, setTo] = useState(session.user.email);
  const [changing, setChanging] = useState(false);
  useEffect(() => setFromName(c.fromName ?? ''), [c.fromName]);
  const save = useMutation({
    mutationFn: (body: { fromName: string | null; isActive: boolean }) => api.patch<Overview>('/integrations/email/settings', body),
    onSuccess: (r, v) => {
      qc.setQueryData(['email-integration'], r);
      toast.success(v.isActive ? 'Saved' : 'Sending from this mailbox is paused — emails go from the system address meanwhile');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ to: string }>('/integrations/email/test', { to }),
    onSuccess: (r) => toast.success(`Test email sent to ${r.to} — check the inbox`),
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => api.del<Overview>('/integrations/email'),
    onSuccess: (r) => {
      qc.setQueryData(['email-integration'], r);
      toast.success('Disconnected — client emails go from the system address');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (changing) return <Connect d={d} onCancel={() => setChanging(false)} />;
  const attention = c.status === 'NEEDS_ATTENTION';
  return (
    <div className="grid gap-6">
      <Card className={cn('overflow-hidden', attention && 'ring-1 ring-warning/40')}>
        <div className="flex flex-wrap items-center gap-4 p-6">
          <ProviderMark provider={c.provider} />
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {c.email}
              {attention ? <Badge variant="warning">Needs attention</Badge> : c.isActive ? <Badge variant="success">Sending</Badge> : <Badge variant="secondary">Paused</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              {c.providerName} · {c.method === 'OAUTH' ? `signed in with ${c.provider === 'GMAIL' ? 'Google' : 'Microsoft'}` : c.provider === 'SMTP' ? `server ${c.smtpHost}` : 'app password'} · connected {fmtDateTime(c.connectedAt)}
              {c.connectedByName && ` by ${c.connectedByName}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {c.sentCount} {c.sentCount === 1 ? 'email' : 'emails'} sent{c.lastSentAt && ` · last ${fmtDateTime(c.lastSentAt)}`}
            </p>
          </div>
          <Button variant="outline" onClick={() => setChanging(true)}>
            {attention ? 'Reconnect' : 'Change mailbox'}
          </Button>
        </div>
        {attention && (
          <div className="flex items-start gap-2 border-t border-warning/25 bg-warning/10 px-6 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>
              <b>The mailbox stopped accepting our emails</b>{c.lastError && ` — ${c.lastError}`}. Until it is reconnected, client emails go from {d.platformSender} with your clinic’s name, so nobody misses a message.
            </span>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Sending</CardTitle>
              <CardDescription className="mt-1">How your emails look to clients.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Sender name" htmlFor="em-from" hint="Shown in the client’s inbox, e.g. “Happy Paws Clinic”. Empty = your clinic’s name.">
              <Input id="em-from" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </Field>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold">Send client emails from this mailbox</span>
                <span className="block text-sm text-muted-foreground">Off: emails go from {d.platformSender} with your clinic’s name.</span>
              </span>
              <Switch checked={c.isActive} onCheckedChange={(v) => save.mutate({ fromName: fromName.trim() || null, isActive: v })} aria-label="Send from this mailbox" />
            </label>
            <div className="flex justify-end">
              <Button disabled={(c.fromName ?? '') === fromName.trim()} loading={save.isPending} onClick={() => save.mutate({ fromName: fromName.trim() || null, isActive: c.isActive })}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Send a test email</CardTitle>
              <CardDescription className="mt-1">Checks the connection end to end.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Send to" htmlFor="em-to">
              <Input id="em-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="ghost"
                className="text-destructive"
                loading={disconnect.isPending}
                onClick={async () => {
                  const r = await confirm({ title: `Disconnect ${c.email}?`, description: `Client emails will go from ${d.platformSender} with your clinic’s name. You can connect again at any time.`, confirmLabel: 'Disconnect', destructive: true });
                  if (r.confirmed) disconnect.mutate();
                }}
              >
                <Unplug /> Disconnect
              </Button>
              <Button loading={test.isPending} disabled={!/\S+@\S+\.\S+/.test(to)} onClick={() => test.mutate()}>
                <Send /> Send test
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmailSettings() {
  const { session } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const q = useQuery({ queryKey: ['email-integration'], queryFn: () => api.get<Overview>('/integrations/email') });
  // Back from Google / Microsoft sign-in.
  useEffect(() => {
    const result = params.get('email');
    if (!result) return;
    const reason = params.get('reason');
    if (result === 'connected') toast.success('Mailbox connected — client emails now go from your own address');
    else if (result === 'cancelled') toast.info('Sign-in was cancelled — nothing changed');
    else if (result === 'expired') toast.error('The sign-in took too long. Please try again.');
    else toast.error(`Could not connect${reason ? `: ${reason}` : ''}`);
    router.replace('/settings/integrations/email');
  }, [params, router]);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const mailbox = hasFeature(session.entitlements, 'mailbox');
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden>
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">Email</h2>
          <p className="text-sm text-muted-foreground">
            {d.connection ? 'Client emails — confirmations, reminders, results and your automations — go from your own mailbox.' : `Client emails now come from ${d.platformSender} with your clinic’s name. Connect your own mailbox so they come from you.`}
          </p>
        </div>
      </div>
      {!mailbox ? (
        <UpgradeCard feature="mailbox" text={`Client emails come from ${d.platformSender} with your clinic’s name. Send them from your own Gmail, Outlook or mail server instead.`} />
      ) : d.connection ? (
        <Connected d={d as Overview & { connection: Connection }} />
      ) : (
        <Connect d={d} />
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl surface-flat p-4 text-sm">
        <CheckCircle2 className="h-4 w-4 text-success" />
        <span className="min-w-0 flex-1">Choose which messages go by email, and build your own, under Automations.</span>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/automations">
            <Workflow /> Automations
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function EmailIntegrationPage() {
  return (
    <RequirePermission anyOf={['integrations.manage', 'settings.manage']}>
      <Suspense>
        <EmailSettings />
      </Suspense>
    </RequirePermission>
  );
}
