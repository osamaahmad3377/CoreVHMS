'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passwordPolicy } from '@vcms/shared';
import { Laptop, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { DescriptionList, LoadingRows, PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed. Other sessions were signed out.');
      setCurrent('');
      setNext('');
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Password</CardTitle>
          <CardDescription className="mt-1">Changing your password signs out all your other sessions.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid max-w-md gap-3">
        {error && <FormError message={error} />}
        <Field label="Current password" htmlFor="cp">
          <Input id="cp" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" htmlFor="np" hint="At least 10 characters with upper-case, lower-case and a number.">
          <Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Button
          className="w-fit"
          loading={m.isPending}
          disabled={!current || !passwordPolicy.safeParse(next).success}
          onClick={() => {
            setError(null);
            m.mutate();
          }}
        >
          Change password
        </Button>
      </CardContent>
    </Card>
  );
}

function Mfa() {
  const { session, refresh } = useSession();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const start = useMutation({ mutationFn: () => api.post<{ secret: string; qrDataUrl: string }>('/auth/mfa/setup'), onSuccess: setSetup, onError: (e: Error) => toast.error(e.message) });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const disable = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { password }),
    onSuccess: () => {
      toast.success('Two-factor authentication disabled');
      setPassword('');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            Two-factor authentication
            {session.user.mfaEnabled ? <Badge variant="success"><ShieldCheck className="h-3 w-3" /> On</Badge> : <Badge variant="warning"><ShieldOff className="h-3 w-3" /> Off</Badge>}
          </CardTitle>
          <CardDescription className="mt-1">Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) for a second sign-in step.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {codes && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-sm font-medium">Save these recovery codes now. Each works once; they will not be shown again.</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {!session.user.mfaEnabled && !setup && (
          <Button className="w-fit" onClick={() => start.mutate()} loading={start.isPending}>
            Set up two-factor authentication
          </Button>
        )}
        {setup && (
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code for authenticator app" className="h-44 w-44 rounded border bg-white p-2" />
            <div className="grid content-start gap-3">
              <p className="text-sm">Scan the QR code, or enter this key manually:</p>
              <code className="w-fit break-all rounded bg-muted px-2 py-1 text-xs">{setup.secret}</code>
              <Field label="6-digit code from the app" htmlFor="mfa-code">
                <Input id="mfa-code" inputMode="numeric" maxLength={6} className="w-40" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Button className="w-fit" disabled={code.length !== 6} loading={enable.isPending} onClick={() => enable.mutate()}>
                Verify and enable
              </Button>
            </div>
          </div>
        )}
        {session.user.mfaEnabled && (
          <div className="flex max-w-md items-end gap-2">
            <Field label="Confirm password to disable" htmlFor="mfa-pw" className="flex-1">
              <Input id="mfa-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button variant="outline" disabled={!password} loading={disable.isPending} onClick={() => disable.mutate()}>
              Disable
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<{ id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[]>('/auth/sessions'),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['my-sessions'] }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
      </CardHeader>
      {q.isLoading ? (
        <LoadingRows rows={2} />
      ) : (
        <ul className="divide-y">
          {q.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Laptop className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{s.userAgent ?? 'Unknown device'}</p>
                <p className="text-xs text-muted-foreground">
                  {s.ip} · signed in {fmtDateTime(s.createdAt)} · active {fmtRelative(s.lastSeenAt)}
                </p>
              </div>
              {s.current ? (
                <Badge variant="success">This device</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AccountPage() {
  const { session } = useSession();
  return (
    <>
      <PageHeader title="Account & security" />
      <div className="grid max-w-4xl gap-4">
        <Card>
          <CardContent>
            <DescriptionList
              items={[
                { label: 'Name', value: session.user.name },
                { label: 'Email', value: session.user.email },
                { label: 'Organization', value: session.organization?.name },
                { label: 'Roles', value: session.roles.map((r) => r.name).join(', ') },
              ]}
            />
          </CardContent>
        </Card>
        <ChangePassword />
        <Mfa />
        <Sessions />
      </div>
    </>
  );
}
