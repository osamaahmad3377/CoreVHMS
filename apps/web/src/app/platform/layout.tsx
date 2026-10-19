'use client';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { FirstPasswordChange } from '@/components/auth/first-password';
import { ConfirmProvider } from '@/components/confirm';
import { ShellSkeleton } from '@/components/layout/shell-skeleton';
import { ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { useSessionQuery } from '@/lib/session';

/** Super admin area (multi-clinic hosting): only platform administrators signed in at the admin address. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();
  const qc = useQueryClient();

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [session.error]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/login';
  };

  if (session.isLoading || (session.error instanceof ApiError && session.error.status === 401)) return <ShellSkeleton />;
  if (session.error || !session.data) return <ErrorState error={session.error} onRetry={() => session.refetch()} className="min-h-screen" />;
  if (session.data.user.mustChangePassword) return <FirstPasswordChange name={session.data.user.name} onDone={() => session.refetch()} />;
  if (!session.data.platform || !session.data.permissions.includes('platform.clinics.manage')) {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <div className="grid justify-items-center gap-3">
          <ErrorState error={new Error('This area is for NextCore super admins only.')} />
          <Button variant="outline" onClick={logout}><LogOut /> Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="font-semibold tracking-tight">NextCore</span>
          <span className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Super admin
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{session.data.user.name}</span>
            <Button variant="ghost" size="sm" onClick={logout}><LogOut /> Sign out</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </ConfirmProvider>
  );
}
