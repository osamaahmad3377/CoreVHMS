'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Home, LogOut, MessageSquare, PawPrint, Receipt, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext } from 'react';
import { LoadingRows } from '../page';
import { Button } from '../ui/button';
import { portalApi, type PortalSession } from '@/lib/portal-api';
import { cn } from '@/lib/utils';
import { tabListClass, tabTriggerClass } from '../ui/tabs';

const Ctx = createContext<PortalSession | null>(null);
export const usePortal = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePortal outside PortalShell');
  return v;
};

const NAV = [
  { href: '/portal', label: 'Home', icon: Home, exact: true, short: 'Home' },
  { href: '/portal/pets', label: 'My animals', icon: PawPrint, short: 'Animals' },
  { href: '/portal/appointments', label: 'Appointments', icon: CalendarDays, short: 'Visits' },
  { href: '/portal/invoices', label: 'Invoices', icon: Receipt, short: 'Invoices' },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare, short: 'Messages' },
  { href: '/portal/settings', label: 'Settings', icon: Settings, short: 'Settings' },
];

/** Client portal layout: clinic header, simple navigation (bottom bar on phones). */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ['portal', 'session'], queryFn: () => portalApi.get<PortalSession>('/auth/session'), staleTime: 60_000 });
  const logout = async () => {
    await portalApi.post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/portal/login';
  };
  if (!session.data) return <div className="mx-auto max-w-5xl p-6"><LoadingRows /></div>;
  const s = session.data;
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));
  return (
    <Ctx.Provider value={s}>
      <div className="app-canvas min-h-screen pb-20 md:pb-0">
        <header className="no-print glass sticky top-0 z-30 border-b border-[hsl(var(--glass-edge))]">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-brand-2 text-white shadow-glow"><PawPrint className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.clinic.name}</p>
              <p className="truncate text-xs text-muted-foreground">Client portal · {s.client.displayName}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}><LogOut /> <span className="hidden sm:inline">Sign out</span></Button>
          </div>
          <nav aria-label="Portal" className={cn(tabListClass, 'mx-auto mb-3 hidden md:flex md:w-fit')}>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href, n.exact) ? 'page' : undefined} className={tabTriggerClass()}>
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
        <nav aria-label="Portal (mobile)" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t bg-card md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px]', active(n.href, n.exact) ? 'text-primary' : 'text-muted-foreground')}>
              <n.icon className="h-5 w-5" /> {n.short}
            </Link>
          ))}
        </nav>
      </div>
    </Ctx.Provider>
  );
}
