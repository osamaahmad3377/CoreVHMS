'use client';
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { visibleNav } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { MENU_LOGO_HEIGHT } from '@vcms/shared';
import { logoFor, menuIsDark } from '../branding/brand-theme';
import { Tip } from '../ui/tooltip';

/** The clinic's logo and brand name (Settings → Branding), or the NextCore mark when none is set. */
export function Logo({ collapsed }: { collapsed?: boolean }) {
  const { session } = useSession();
  const branding = session.organization?.branding;
  const logo = logoFor(branding, menuIsDark(branding));
  const icon = collapsed ? (branding?.iconUrl ?? logo) : (logo ?? branding?.iconUrl);
  const height = collapsed ? 32 : MENU_LOGO_HEIGHT[branding?.menuLogoSize ?? 'MEDIUM'];
  const name = branding?.brandName ?? session.organization?.name ?? 'NextCore';
  return (
    <Link href="/dashboard" className={cn('flex min-w-0 flex-col items-center text-center text-sidebar-strong', !collapsed && 'w-full gap-2')} aria-label={`${name} — home`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon ?? '/favicon.svg'} alt="" style={{ height }} className={cn('max-w-full shrink-0 object-contain', !icon && 'aspect-square')} />
      {!collapsed && <span className="line-clamp-2 block w-full text-balance text-[0.9375rem] font-semibold leading-tight tracking-tight">{name}</span>}
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
    <nav aria-label="Main" className="flex flex-col gap-4 px-3 py-4">
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
                        'group/nav relative flex items-center gap-3 rounded-xl px-2 py-1.5 text-[0.8125rem] font-medium text-sidebar-foreground transition-all duration-200 ease-apple hover:bg-sidebar-hover hover:text-sidebar-strong',
                        active && 'bg-sidebar-active text-white shadow-[0_4px_12px_-4px_hsl(var(--sidebar-active)/0.55),inset_0_1px_0_hsl(0_0%_100%/0.18)] hover:bg-sidebar-active hover:text-white',
                        collapsed && 'mx-auto h-10 w-10 justify-center p-0',
                      )}
                    >
                      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-200', active ? 'bg-white/20' : 'bg-sidebar-strong/[0.06] group-hover/nav:bg-sidebar-strong/10')}>
                        <item.icon className="h-[15px] w-[15px]" aria-hidden />
                      </span>
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

function SidebarFooter({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { session } = useSession();
  const name = session.user.name;
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const role = session.roles.map((r) => r.name.replace(/ & procurement officer$/, ' officer')).join(', ');
  return (
    <div className={cn('border-t border-sidebar-border/70 p-3', collapsed && 'px-2')}>
      {!collapsed && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl bg-sidebar-strong/[0.05] p-2">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-xs font-semibold text-white shadow-sm">{initials}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[0.8125rem] font-semibold text-sidebar-strong">{name}</span>
            <span className="block truncate text-2xs text-sidebar-foreground/70" title={role}>{role}</span>
          </span>
        </div>
      )}
      <button
        onClick={onToggle}
        className={cn('flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-hover hover:text-sidebar-strong')}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse menu</>}
      </button>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border/70 bg-sidebar transition-[width] duration-300 ease-apple lg:flex',
        collapsed ? 'w-[68px]' : 'w-[256px]',
      )}
    >
      <div className={cn('flex shrink-0 items-center justify-center px-5 pb-3 pt-6', collapsed && 'px-0 pb-2 pt-4')}>
        <Logo collapsed={collapsed} />
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        <SidebarNav collapsed={collapsed} />
      </div>
      <SidebarFooter collapsed={collapsed} onToggle={onToggle} />
    </aside>
  );
}
