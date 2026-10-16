'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { FormError } from '@/components/forms/form-error';
import { Field } from '@/components/forms/field';
import { PortalAuthCard } from '@/components/portal/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { portalApi } from '@/lib/portal-api';

function Accept({ mode }: { mode: 'accept' | 'reset' }) {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords do not match');
    setError(null);
    setBusy(true);
    try {
      await portalApi.post(mode === 'accept' ? '/auth/accept' : '/auth/reset', { token, password });
      if (mode === 'accept') window.location.href = '/portal';
      else setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (done) return <PortalAuthCard title="Password changed" description="You can now sign in with your new password."><Button asChild className="w-full"><a href="/portal/login">Sign in</a></Button></PortalAuthCard>;
  return (
    <PortalAuthCard title={mode === 'accept' ? 'Set up your account' : 'Choose a new password'} description="Use at least 10 characters, with upper-case and lower-case letters and a number.">
      <form className="grid gap-3" onSubmit={submit}>
        {!token && <FormError message="This link is incomplete. Open the link from your email again." />}
        {error && <FormError message={error} />}
        <Field label="New password" htmlFor="pa-pw"><Input id="pa-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Field label="Confirm password" htmlFor="pa-pw2"><Input id="pa-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
        <Button type="submit" loading={busy} disabled={!token}>{mode === 'accept' ? 'Create account' : 'Save password'}</Button>
      </form>
    </PortalAuthCard>
  );
}

export default function PortalResetPage() {
  return <Suspense><Accept mode="reset" /></Suspense>;
}
