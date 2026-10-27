'use client';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, LayoutDashboard, LayoutList, LogOut, ReceiptText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { FirstPasswordChange } from '@/components/auth/first-password';
import { ConfirmProvider } from '@/components/confirm';
import { ShellSkeleton } from '@/components/layout/shell-skeleton';
import { ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { tabListClass, tabTriggerClass } from '@/components/ui/tabs';
import { ApiError, api } from '@/lib/api';
import { useSessionQuery } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Super admin area (multi-clinic hosting): only platform administrators signed in at the admin address. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = useSessionQuery();
  const qc = useQueryClient();
  const pathname = usePathname();

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
      <div className="app-canvas grid min-h-screen place-items-center p-4">
        <div className="grid justify-items-center gap-3">
          <ErrorState error={new Error('This area is for NextCore super admins only.')} />
          <Button variant="outline" onClick={logout}><LogOut /> Sign out</Button>
        </div>
      </div>
    );
  }

  return (
    <ConfirmProvider>
      <div className="app-canvas min-h-screen">
        <div className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
        <header className="glass mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-2xl border border-[hsl(var(--glass-edge))] px-4 shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="hidden font-semibold tracking-tight sm:inline">NextCore</span>
          <span className="hidden items-center gap-1 rounded-pill bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20 lg:flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Super admin
          </span>
          <nav aria-label="Super admin" className={cn(tabListClass, 'ml-2 lg:ml-4')}>
            {[
              { href: '/platform', label: 'Dashboard', icon: LayoutDashboard, active: pathname === '/platform' },
              { href: '/platform/clinics', label: 'Clinics', icon: Building2, active: pathname.startsWith('/platform/clinics') },
              ...(session.data.permissions.includes('platform.billing.manage') ? [{ href: '/platform/payments', label: 'Payments', icon: ReceiptText, active: pathname.startsWith('/platform/payments') }] : []),
              ...(session.data.permissions.includes('platform.plans.manage') ? [{ href: '/platform/plans', label: 'Plans', icon: LayoutList, active: pathname.startsWith('/platform/plans') }] : []),
            ].map((i) => (
              <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined} className={tabTriggerClass()} title={i.label}>
                <i.icon className="h-4 w-4" /> <span className="hidden md:inline">{i.label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground xl:inline">{session.data.user.name}</span>
            <Button variant="ghost" size="sm" onClick={logout} title="Sign out"><LogOut /> <span className="hidden sm:inline">Sign out</span></Button>
          </div>
        </header>
        </div>
        <main className="page-enter mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-6 lg:pt-8">{children}</main>
      </div>
    </ConfirmProvider>
  );
}
