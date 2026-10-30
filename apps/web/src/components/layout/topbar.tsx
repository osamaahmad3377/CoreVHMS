'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Crown, ChevronDown, CircleHelp, LogOut, Menu, Moon, Plus, Search, Shield, Sun } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { markThemeChosen } from '@/lib/theme-choice';
import { useSession } from '@/lib/session';
import { useCreateActions } from './create-actions';
import { ClockButton } from '../staff/attendance';
import { useModKey } from '../help/shortcuts';
import { Button } from '../ui/button';
import { SuggestionsMenu } from './suggestions-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Avatar, Kbd } from '../ui/misc';

export function Topbar({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const { session, can, canAny } = useSession();
  const planLabel = session.entitlements?.planName ? `${session.entitlements.planName} plan` : 'Full access';
  const qc = useQueryClient();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();

  const switchCtx = useMutation({
    mutationFn: (body: { organizationId: string; branchId?: string }) => api.post('/auth/switch', body),
    onSuccess: async () => {
      await qc.resetQueries();
      router.refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    window.location.href = '/login';
  };

  const quick = useCreateActions();
  const mod = useModKey();

  return (
    <div className="no-print sticky top-0 z-30 px-3 pt-3 sm:px-4 lg:px-6">
    <header className="glass flex h-14 items-center gap-2 rounded-2xl border border-[hsl(var(--glass-edge))] px-2 shadow-card sm:px-3">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>

      <button
        onClick={onSearch}
        aria-label={`Search everything (${mod} K)`}
        title={`Search a name, or type what you want to do (${mod} K)`}
        className="flex h-10 min-w-0 shrink items-center gap-2 rounded-pill bg-foreground/[0.05] px-3 text-sm text-muted-foreground ring-1 ring-inset ring-foreground/[0.06] transition-all duration-200 ease-apple hover:bg-foreground/[0.08] sm:w-full sm:max-w-md sm:px-4"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 truncate text-left sm:block">Search a name or phone<span className="hidden lg:inline"> — or type what you want to do</span></span>
        <span className="hidden items-center gap-0.5 xl:flex">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
        <ClockButton />
        <SuggestionsMenu onOpenFinder={onSearch} />
        <Button variant="ghost" size="icon" asChild title="Help centre — guides for every task">
          <Link href="/help" aria-label="Help centre"><CircleHelp /></Link>
        </Button>
        {quick.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1" title="Add a client, patient, appointment and more">
                <Plus /> New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
              {quick.map((q) => (
                <DropdownMenuItem key={q.href} asChild>
                  <Link href={q.href}>
                    <q.icon /> {q.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {session.branches.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="hidden max-w-[220px] gap-1.5 md:inline-flex" aria-label="Switch branch">
                <Building2 />
                <span className="truncate">{session.branch?.name ?? 'Select branch'}</span>
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{session.organization?.name}</DropdownMenuLabel>
              {session.branches.map((b) => (
                <DropdownMenuItem
                  key={b.id}
                  onSelect={() => session.organization && switchCtx.mutate({ organizationId: session.organization.id, branchId: b.id })}
                >
                  <Check className={b.id === session.branch?.id ? 'opacity-100' : 'opacity-0'} />
                  {b.name}
                </DropdownMenuItem>
              ))}
              {session.organizations.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Switch clinic</DropdownMenuLabel>
                  {session.organizations
                    .filter((o) => o.id !== session.organization?.id)
                    .map((o) => (
                      <DropdownMenuItem key={o.id} onSelect={() => switchCtx.mutate({ organizationId: o.id })}>
                        <Building2 /> {o.name}
                      </DropdownMenuItem>
                    ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex"
          onClick={() => { markThemeChosen(); setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); }}
          aria-label="Toggle dark mode"
        >
          {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-pill p-1 pr-1.5 transition-colors hover:bg-foreground/[0.06]" aria-label="Account menu">
              <Avatar name={session.user.name} />
              <span className="hidden text-left leading-tight xl:block">
                <span className="block max-w-[200px] truncate text-sm font-medium">{session.user.name}</span>
                <span className="block max-w-[200px] truncate text-2xs text-muted-foreground" title={session.roles.map((r) => r.name).join(', ')}>{session.roles.map((r) => r.name.replace(/ & procurement officer$/, ' officer')).join(', ')}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-sm font-medium text-foreground">{session.user.name}</div>
              <div className="truncate text-xs">{session.user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canAny('org.manage') ? (
              <DropdownMenuItem asChild>
                <Link href="/settings/plan">
                  <Crown className="text-amber-500" /> {planLabel}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                <Crown className="h-4 w-4 text-amber-500" /> <span className="text-sm text-foreground">{planLabel}</span>
              </DropdownMenuLabel>
            )}
            {session.branches.length > 1 && (
              <div className="md:hidden">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Branch</DropdownMenuLabel>
                {session.branches.map((b) => (
                  <DropdownMenuItem key={b.id} onSelect={() => session.organization && switchCtx.mutate({ organizationId: session.organization.id, branchId: b.id })}>
                    <Check className={b.id === session.branch?.id ? 'opacity-100' : 'opacity-0'} /> {b.name}
                  </DropdownMenuItem>
                ))}
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="sm:hidden" onSelect={() => { markThemeChosen(); setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); }}>
              {resolvedTheme === 'dark' ? <Sun /> : <Moon />} {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account">
                <Shield /> Account & security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    </div>
  );
}
