'use client';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/forms/form-error';
import { ApiError, api } from '@/lib/api';

/**
 * NextCore support: opened from the super admin console with a one-time link in the address's #fragment (never
 * sent to the server in the URL). Exchanges it for a System account session, then opens the clinic.
 */
export default function SystemSignInPage() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    // Take the link out of the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      setError('This sign-in link is incomplete. Open the clinic again from the NextCore console.');
      return;
    }
    api
      .post('/auth/system-sign-in', { token })
      .then(() => window.location.replace('/dashboard'))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Sign-in failed'));
  }, []);

  return (
    <div className="grid gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <ShieldAlert className="h-6 w-6 text-warning" /> NextCore support
      </h1>
      {error ? (
        <FormError message={error} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Signing in as System…
        </p>
      )}
    </div>
  );
}
