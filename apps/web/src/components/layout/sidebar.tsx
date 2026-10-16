'use client';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleNav } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Tip } from '../ui/tooltip';

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-1 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/favicon.svg" alt="" className="h-7 w-7" />
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">NextCore</span>
          <span className="block text-2xs uppercase tracking-wider text-sidebar-foreground/60">Veterinary</span>
        </span>
      )}
    </Link>
  );
}

export function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { canAny } = useSession();
  const pathname = usePathname();
  const sections = visibleNav(canAny);
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-2 py-3">
      {sections.map((s) => (
        <div key={s.label}>
          {!collapsed && <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">{s.label}</p>}
          <ul className="grid gap-0.5">
            {s.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-white/5 hover:text-white',
                    active && 'bg-sidebar-active text-white hover:bg-sidebar-active',
                    collapsed && 'justify-center px-0 py-2',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                </Link>
              );
              return <li key={item.href}>{collapsed ? <Tip label={item.label} side="right">{link}</Tip> : link}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-sidebar-border px-3', collapsed && 'justify-center px-0')}>
        <Logo collapsed={collapsed} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
      </div>
      <button
        onClick={onToggle}
        className="flex h-10 items-center justify-center gap-2 border-t border-sidebar-border text-xs text-sidebar-foreground/70 hover:text-white"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
      </button>
    </aside>
  );
}
