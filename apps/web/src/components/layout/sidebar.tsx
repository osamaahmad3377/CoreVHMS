'use client';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { visibleNav } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { logoFor, menuIsDark } from '../branding/brand-theme';
import { Tip } from '../ui/tooltip';

/** The clinic's logo and brand name (Settings → Branding), or the NextCore mark when none is set. */
export function Logo({ collapsed }: { collapsed?: boolean }) {
  const branding = useSession().session.organization?.branding;
  const logo = logoFor(branding, menuIsDark(branding));
  const icon = collapsed ? (branding?.iconUrl ?? logo) : (logo ?? branding?.iconUrl);
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2 px-1 text-sidebar-strong" aria-label={`${branding?.brandName ?? 'NextCore'} — home`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon ?? '/favicon.svg'} alt="" className={cn('h-8 shrink-0 object-contain', icon && !collapsed ? 'max-w-[56px]' : 'w-8')} />
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold tracking-tight">{branding?.brandName ?? 'NextCore'}</span>
          {!branding && <span className="block text-2xs uppercase tracking-wider text-sidebar-foreground/60">Veterinary</span>}
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
  const { canAny, session } = useSession();
  const pathname = usePathname();
  const sections = visibleNav(canAny, session.organization?.enabledModules);
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
                className="group mb-1 flex w-full items-center justify-between rounded px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-sidebar-foreground/50 hover:text-sidebar-foreground"
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
                        'group/nav relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[0.8125rem] text-sidebar-foreground transition-all duration-200 ease-apple hover:bg-sidebar-hover hover:text-sidebar-strong',
                        active && 'bg-sidebar-active font-medium text-white shadow-[0_1px_2px_hsl(var(--sidebar-active)/0.35)] hover:bg-sidebar-active hover:text-white',
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
        'no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border/70 bg-sidebar transition-[width] duration-300 ease-apple lg:flex',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-0')}>
        <Logo collapsed={collapsed} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
      </div>
      <button
        onClick={onToggle}
        className="flex h-10 items-center justify-center gap-2 border-t border-sidebar-border text-xs text-sidebar-foreground/70 hover:text-sidebar-strong"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
      </button>
    </aside>
  );
}
