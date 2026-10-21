'use client';
import { useMutation } from '@tanstack/react-query';
import { passwordPolicy } from '@vcms/shared';
import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

/**
 * Shown instead of the application while the user is signed in with a temporary password from an administrator.
 * The API refuses every other request until this is done.
 */
export function FirstPasswordChange({ name, onDone }: { name: string; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const strong = passwordPolicy.safeParse(next).success;
  const m = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: onDone,
    onError: (e: Error) => setError(e.message),
  });
  const signOut = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    window.location.href = '/login';
  };
  return (
    <div className="app-canvas flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Choose your own password</CardTitle>
            <CardDescription className="mt-1">
              Welcome, {name}. You signed in with a temporary password from your administrator. Choose a password only you know to continue.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              m.mutate();
            }}
          >
            {error && <FormError message={error} />}
            <Field label="Temporary password" htmlFor="fp-current">
              <Input id="fp-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" htmlFor="fp-new" hint="At least 10 characters with upper-case, lower-case and a number.">
              <Input id="fp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Repeat new password" htmlFor="fp-repeat" error={repeat && repeat !== next ? { message: 'The passwords do not match', type: 'validate' } : undefined}>
              <Input id="fp-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </Field>
            <Button type="submit" loading={m.isPending} disabled={!current || !strong || next !== repeat}>Save password and continue</Button>
            <Button type="button" variant="ghost" onClick={signOut}><LogOut /> Sign out</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
