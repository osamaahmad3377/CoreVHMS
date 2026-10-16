'use client';
import { passwordPolicy } from '@vcms/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { FormError } from '@/components/forms/form-error';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const policy = passwordPolicy.safeParse(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Passwords do not match');
    if (!policy.success) return setError(policy.error.issues[0].message);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="grid gap-3">
        <h1 className="text-xl font-semibold">Password updated</h1>
        <p className="text-sm text-muted-foreground">All existing sessions were signed out. Sign in with your new password.</p>
        <Button asChild><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {!token && <FormError message="This reset link is incomplete. Request a new one." />}
      {error && <FormError message={error} />}
      <Field label="New password" htmlFor="pw" hint="At least 10 characters with upper-case, lower-case and a number.">
        <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="pw2">
        <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} disabled={!token}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
