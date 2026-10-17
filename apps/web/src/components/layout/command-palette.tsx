'use client';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { BedDouble, ClipboardList, CornerDownLeft, FlaskConical, Home, Loader2, PawPrint, Pill, Receipt, Scissors, Search, Send, ShieldCheck, Siren, Tractor, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import { visibleNav } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { useCreateActions } from './create-actions';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Kbd } from '../ui/misc';

interface Hit {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
  badge?: string | null;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  patient: PawPrint, client: User, invoice: Receipt, prescription: Pill, sample: FlaskConical, labOrder: FlaskConical, admission: BedDouble, surgery: Scissors,
  farm: Tractor, outbreak: Siren, boarding: Home, grooming: Scissors, claim: ShieldCheck, policy: ClipboardList, referral: Send,
};
const GROUPS: Record<string, string> = {
  patient: 'Patients', client: 'Clients', invoice: 'Invoices', prescription: 'Prescriptions', sample: 'Lab samples', labOrder: 'Lab orders', admission: 'Hospital stays',
  surgery: 'Surgeries', farm: 'Farms', outbreak: 'Outbreaks', boarding: 'Boarding', grooming: 'Grooming', claim: 'Insurance claims', policy: 'Insurance policies', referral: 'Referrals',
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { canAny } = useSession();
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 200);
  const search = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<{ results: Hit[] }>(`/search${qs({ q })}`),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!open) setTerm('');
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const results = search.data?.results ?? [];
  const grouped = results.reduce<Record<string, Hit[]>>((acc, h) => ((acc[h.type] ??= []).push(h), acc), {});
  const pages = visibleNav(canAny).flatMap((s) => s.items);
  const needle = term.trim().toLowerCase();
  // Typing, or the request is still in flight: say so rather than showing an empty list.
  const searching = term.trim().length >= 2 && (term.trim() !== q || search.isFetching);
  const matchedPages = needle.length >= 2 ? pages.filter((p) => p.label.toLowerCase().includes(needle)).slice(0, 5) : [];
  const actions = useCreateActions().filter((a) => !needle || `${a.label} ${a.keywords}`.toLowerCase().includes(needle));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command shouldFilter={false} className="flex flex-col" label="Global search">
          <div className="flex items-center gap-2 border-b pl-3 pr-12">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={term}
              onValueChange={setTerm}
              autoFocus
              placeholder="Search patients, owners, phone, microchip, or a number (C-, P-, INV-, RX-…)"
              className="h-12 min-w-0 flex-1 border-0 bg-transparent text-sm shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            />
            {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            {searching && results.length === 0 && (
              <Command.Loading>
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>
              </Command.Loading>
            )}
            {q.length >= 2 && !searching && search.isError && (
              <div className="px-3 py-8 text-center text-sm text-destructive" role="alert">Search is unavailable right now — try again in a moment.</div>
            )}
            {q.length >= 2 && !searching && !search.isError && results.length === 0 && matchedPages.length === 0 && (
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">No matches for “{q}”.</Command.Empty>
            )}
            {Object.entries(grouped).map(([type, hits]) => {
              const Icon = ICONS[type] ?? Search;
              return (
                <Command.Group key={type} heading={GROUPS[type] ?? type} className="mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                  {hits.map((h) => (
                    <Command.Item
                      key={`${h.type}-${h.id}`}
                      value={`${h.type}-${h.id}`}
                      onSelect={() => go(h.href)}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{h.title}</div>
                        {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                      </div>
                      {h.badge && <Badge variant="secondary">{h.badge}</Badge>}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
            {actions.length > 0 && (
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                {actions.map((a) => (
                  <Command.Item key={a.href} value={`action-${a.href}`} onSelect={() => go(a.href)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-muted">
                    <a.icon className="h-4 w-4 text-primary" />
                    {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {(q.length < 2 || matchedPages.length > 0) && (
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                {(q.length < 2 ? pages : matchedPages).map((p) => (
                  <Command.Item
                    key={p.href}
                    value={p.href}
                    onSelect={() => go(p.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-muted"
                  >
                    <p.icon className="h-4 w-4 text-muted-foreground" />
                    {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-2xs text-muted-foreground">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span className="flex items-center gap-1"><Kbd><CornerDownLeft className="h-3 w-3" /></Kbd> open</span>
            <span className="flex items-center gap-1"><Kbd>Esc</Kbd> close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
