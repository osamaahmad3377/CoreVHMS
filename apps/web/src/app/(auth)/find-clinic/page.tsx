'use client';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api, qs } from '@/lib/api';
import { useHostInfo } from '@/lib/host';

/** Shown at the bare domain: each clinic signs in at its own address. */
export default function FindClinicPage() {
  const host = useHostInfo().data;
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.get<{ found: boolean; address?: string }>(`/tenant/lookup${qs({ address: address.trim().toLowerCase() })}`);
      if (r.found && r.address) window.location.href = `${r.address}/login`;
      else setError('No clinic uses that address. Check the spelling, or ask your clinic manager for the address.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form method="post" onSubmit={submit} className="grid gap-4" noValidate>
      <div>
        <Building2 className="mb-3 h-8 w-8 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Find your clinic</h1>
        <p className="mt-1 text-sm text-muted-foreground">Each clinic has its own web address. Enter yours to go to its sign-in page.</p>
      </div>
      {error && <FormError message={error} />}
      <Field label="Your clinic’s address" htmlFor="address" hint="Your clinic manager can tell you this.">
        <div className="flex items-center gap-2">
          <Input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="yourclinic"
          />
          {host?.baseDomain && <span className="shrink-0 text-sm text-muted-foreground">.{host.baseDomain}</span>}
        </div>
      </Field>
      <Button type="submit" loading={busy} disabled={address.trim().length < 3}>
        Go to sign-in
      </Button>
    </form>
  );
}
