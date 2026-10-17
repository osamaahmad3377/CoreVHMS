'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema } from '@vcms/shared';
import { KeyRound } from 'lucide-react';
import { FormError } from '@/components/forms/form-error';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

type LoginResponse = { mfaRequired: boolean; challengeId?: string };

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const done = async () => {
    qc.clear();
    router.replace(safeNext(params.get('next')));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values);
      if (res.mfaRequired) setChallenge(res.challengeId!);
      else await done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed');
    }
  });

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/verify', { challengeId: challenge, code });
      await done();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
      if (err instanceof ApiError && err.code === 'MFA_EXPIRED') setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <form method="post" onSubmit={verify} className="grid gap-4">
        <div>
          <KeyRound className="mb-3 h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">Two-factor verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
        {error && <FormError message={error} />}
        <Field label="Verification code" htmlFor="code">
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" autoFocus />
        </Field>
        <Button type="submit" loading={busy} disabled={code.trim().length < 6}>
          Verify and sign in
        </Button>
        <Button type="button" variant="link" onClick={() => setChallenge(null)}>
          Use a different account
        </Button>
      </form>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use your clinic staff account.</p>
      </div>
      {error && <FormError message={error} />}
      <Field label="Email" htmlFor="email" error={form.formState.errors.email}>
        <Input id="email" type="email" autoComplete="username" autoFocus {...form.register('email')} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
      </Field>
      <div className="-mt-2 text-right">
        <Link href="/forgot-password" className="text-xs text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New practice?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an organization
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
