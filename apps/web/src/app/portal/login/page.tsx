'use client';
import Link from 'next/link';
import { useState } from 'react';
import { FormError } from '@/components/forms/form-error';
import { Field } from '@/components/forms/field';
import { PortalAuthCard } from '@/components/portal/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { portalApi } from '@/lib/portal-api';

export default function PortalLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await portalApi.post('/auth/login', { email, password });
      window.location.href = '/portal';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <PortalAuthCard title="Sign in" description="See your animals’ records, vaccinations, appointments and invoices.">
      <form method="post" className="grid gap-3" onSubmit={submit}>
        {error && <FormError message={error} />}
        <Field label="Email" htmlFor="pl-email"><Input id="pl-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" htmlFor="pl-pw"><Input id="pl-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <Button type="submit" loading={busy}>Sign in</Button>
        <Link href="/portal/forgot" className="text-center text-sm text-primary hover:underline">Forgot your password?</Link>
        <p className="text-center text-xs text-muted-foreground">No account? Ask your clinic to invite you.</p>
      </form>
    </PortalAuthCard>
  );
}
