'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field } from '@/components/forms/field';
import { LoadingRows } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { FormError } from '@/components/forms/form-error';

function AcceptForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ email: string; name: string; organizationName: string; requiresPassword: boolean }>(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return <FormError message="This invitation link is incomplete." />;
  if (invite.isLoading) return <LoadingRows rows={3} />;
  if (invite.error) return <FormError message={(invite.error as Error).message} />;
  const inv = invite.data!;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/invitations/accept', { token, name: name || inv.name, password });
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Join {inv.organizationName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {inv.requiresPassword ? 'Set up your account to get started.' : 'Confirm with your existing password to join.'}
        </p>
      </div>
      {error && <FormError message={error} />}
      <Field label="Email" htmlFor="email">
        <Input id="email" value={inv.email} disabled />
      </Field>
      {inv.requiresPassword && (
        <Field label="Your full name" htmlFor="name">
          <Input id="name" defaultValue={inv.name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field
        label={inv.requiresPassword ? 'Create password' : 'Your password'}
        htmlFor="pw"
        hint={inv.requiresPassword ? 'At least 10 characters with upper-case, lower-case and a number.' : undefined}
      >
        <Input id="pw" type="password" autoComplete={inv.requiresPassword ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" loading={busy} disabled={!password}>Accept invitation</Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptForm />
    </Suspense>
  );
}
