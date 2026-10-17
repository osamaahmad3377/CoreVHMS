'use client';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { FormError } from '@/components/forms/form-error';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="grid gap-3">
        <MailCheck className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">If an account exists for {email}, we sent a link to reset the password. The link expires in 60 minutes.</p>
        <Link href="/login" className="text-sm text-primary hover:underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">We will email you a single-use reset link.</p>
      </div>
      {error && <FormError message={error} />}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </Field>
      <Button type="submit" loading={busy}>Send reset link</Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">Back to sign in</Link>
    </form>
  );
}
