'use client';
import { useEffect } from 'react';
import { FirstPasswordChange } from '@/components/auth/first-password';
import { ConfirmProvider } from '@/components/confirm';
import { AppShell } from '@/components/layout/app-shell';
import { ShellSkeleton } from '@/components/layout/shell-skeleton';
import { ErrorState } from '@/components/page';
import { ApiError } from '@/lib/api';
import { SessionProvider, useSessionQuery } from '@/lib/session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }, [session.error]);

  if (session.isLoading || (session.error instanceof ApiError && session.error.status === 401)) return <ShellSkeleton />;
  if (session.error || !session.data) {
    return <ErrorState error={session.error} onRetry={() => session.refetch()} className="min-h-screen" />;
  }
  if (session.data.user.mustChangePassword) {
    return <FirstPasswordChange name={session.data.user.name} onDone={() => session.refetch()} />;
  }
  if (!session.data.organization) {
    return (
      <ErrorState
        className="min-h-screen"
        error={new Error('Your account is not an active member of any organization. Ask your practice manager for an invitation.')}
      />
    );
  }
  return (
    <SessionProvider session={session.data}>
      <ConfirmProvider>
        <AppShell>{children}</AppShell>
      </ConfirmProvider>
    </SessionProvider>
  );
}
