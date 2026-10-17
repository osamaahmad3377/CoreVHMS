'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import type { ClientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export interface PickedClient {
  id: string;
  displayName: string;
  clientNo?: string;
  mobilePhone?: string | null;
}

/** Searchable client selector (name, phone, email or client number). */
export function ClientPicker({
  value,
  onChange,
  excludeId,
  placeholder = 'Search owner by name, phone or number…',
  id,
  invalid,
  defaultOpen = false,
}: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  excludeId?: string;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  /** Open the search straight away (e.g. after the user clicked “Add client”). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 250);
  const results = useQuery({
    queryKey: ['client-picker', q],
    queryFn: () => api.get<Paginated<ClientRow>>(`/clients${qs({ q, pageSize: 8, status: 'ACTIVE' })}`),
    enabled: open && q.length >= 2,
  });
  const rows = (results.data?.data ?? []).filter((r) => r.id !== excludeId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          className={cn('w-full justify-between font-normal', !value && 'text-muted-foreground', invalid && 'border-destructive')}
        >
          <span className="truncate">{value ? `${value.displayName}${value.clientNo ? ` (${value.clientNo})` : ''}` : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Type at least 2 characters…"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
            aria-label="Search clients"
          />
          {results.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {q.length < 2 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Search by surname, phone, email or C-number</li>}
          {q.length >= 2 && !results.isFetching && rows.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">No active clients found</li>
          )}
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === r.id}
                onClick={() => {
                  onChange({ id: r.id, displayName: r.displayName, clientNo: r.clientNo, mobilePhone: r.mobilePhone });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn('h-4 w-4', value?.id === r.id ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.clientNo} · {r.mobilePhone ?? r.email ?? 'no contact'}
                    {r.patients.length > 0 && ` · ${r.patients.map((p) => p.name).join(', ')}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
