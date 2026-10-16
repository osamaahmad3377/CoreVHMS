'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Field } from '@/components/forms/field';
import { PortalAuthCard } from '@/components/portal/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { portalApi } from '@/lib/portal-api';

export default function PortalForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await portalApi.post('/auth/forgot', { email }).catch(() => undefined);
    setSent(true);
    setBusy(false);
  };
  return (
    <PortalAuthCard title="Reset your password">
      {sent ? (
        <p className="text-sm">If an account exists for <b>{email}</b>, we have emailed a link to reset the password. It is valid for one hour. <Link className="text-primary hover:underline" href="/portal/login">Back to sign in</Link></p>
      ) : (
        <form className="grid gap-3" onSubmit={submit}>
          <Field label="Email" htmlFor="pf-email"><Input id="pf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Button type="submit" loading={busy}>Send reset link</Button>
          <Link href="/portal/login" className="text-center text-sm text-primary hover:underline">Back to sign in</Link>
        </form>
      )}
    </PortalAuthCard>
  );
}
