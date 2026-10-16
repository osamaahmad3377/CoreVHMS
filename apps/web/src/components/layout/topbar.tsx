'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, Building2, CalendarPlus, Check, ChevronDown, CircleHelp, ClipboardList, LogOut, Menu, Moon, Plus, Receipt, Search, Shield, ShoppingCart, Stethoscope, Sun, UserPlus, PawPrint } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button } from '../ui/button';
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
  const { session, can } = useSession();
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

  const quick = [
    can('clients.write') && { label: 'New client', href: '/clients/new', icon: UserPlus },
    can('patients.write') && { label: 'Register patient', href: '/patients/new', icon: PawPrint },
    can('appointments.write') && { label: 'New appointment', href: '/calendar', icon: CalendarPlus },
    can('appointments.checkin') && { label: 'Walk-in / emergency', href: '/front-desk', icon: ClipboardList },
    can('clinical.write') && { label: 'Consultations', href: '/consultations', icon: Stethoscope },
    can('pos.use') && { label: 'Counter sale', href: '/pos', icon: ShoppingCart },
    can('billing.write') && { label: 'New invoice', href: '/billing/invoices/new', icon: Receipt },
    can('inventory.write') && { label: 'Receive stock', href: '/inventory?receive=1', icon: Boxes },
    can('procurement.request') && { label: 'Request an item', href: '/inventory/requests?new=1', icon: Boxes },
  ].filter(Boolean) as { label: string; href: string; icon: React.ComponentType }[];

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>

      <button
        onClick={onSearch}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Search patients, owners, phone…</span>
        <span className="hidden items-center gap-0.5 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon" asChild title="Help centre — guides for every task">
          <Link href="/help" aria-label="Help centre"><CircleHelp /></Link>
        </Button>
        {quick.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus /> <span className="hidden sm:inline">New</span>
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
                  <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
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
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle dark mode"
        >
          {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md p-1 hover:bg-muted" aria-label="Account menu">
              <Avatar name={session.user.name} />
              <span className="hidden text-left leading-tight xl:block">
                <span className="block max-w-[160px] truncate text-sm font-medium">{session.user.name}</span>
                <span className="block max-w-[160px] truncate text-2xs text-muted-foreground">{session.roles.map((r) => r.name).join(', ')}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="truncate text-sm font-medium text-foreground">{session.user.name}</div>
              <div className="truncate text-xs">{session.user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
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
  );
}
