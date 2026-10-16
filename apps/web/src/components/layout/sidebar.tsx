'use client';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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

const FOLD_KEY = 'vcms.nav.folded';
const readFolded = (): string[] => {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]'); } catch { return []; }
};

export function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { canAny } = useSession();
  const pathname = usePathname();
  const sections = visibleNav(canAny);
  // Sections the user folded away (remembered on this computer); the section with the current page always shows.
  const [folded, setFolded] = useState<string[]>([]);
  useEffect(() => setFolded(readFolded()), []);
  const toggle = (label: string) => setFolded((f) => {
    const next = f.includes(label) ? f.filter((x) => x !== label) : [...f, label];
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  return (
    <nav aria-label="Main" className="flex flex-col gap-3 px-2 py-3">
      {sections.map((s) => {
        const hasActive = s.items.some((i) => isActive(i.href));
        const open = collapsed || hasActive || !folded.includes(s.label);
        return (
          <div key={s.label}>
            {!collapsed && (
              <button
                type="button"
                onClick={() => toggle(s.label)}
                aria-expanded={open}
                className="group mb-1 flex w-full items-center justify-between rounded px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground"
              >
                {s.label}
                <ChevronDown className={cn('h-3 w-3 opacity-0 transition-transform group-hover:opacity-100', !open && '-rotate-90 opacity-100')} aria-hidden />
              </button>
            )}
            {open && (
              <ul className="grid gap-0.5">
                {s.items.map((item) => {
                  const active = isActive(item.href);
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
            )}
          </div>
        );
      })}
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
