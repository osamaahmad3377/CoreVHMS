'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import type { PatientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export type PickedPatient = Pick<PatientRow, 'id' | 'name' | 'patientNo' | 'species' | 'owner' | 'alerts'>;

/** Searchable patient selector (name, owner, microchip/tag, P-number). */
export function PatientPicker({
  value,
  onChange,
  excludeId,
  speciesId,
  ownerId,
  placeholder = 'Search patient, owner, microchip…',
  id,
  invalid,
}: {
  value: PickedPatient | null;
  onChange: (p: PickedPatient | null) => void;
  excludeId?: string;
  speciesId?: string;
  ownerId?: string;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const q = useDebounce(term.trim(), 250);
  const browse = !!ownerId;
  const results = useQuery({
    queryKey: ['patient-picker', q, speciesId, ownerId],
    queryFn: () => api.get<Paginated<PatientRow>>(`/patients${qs({ q: q || undefined, pageSize: 10, speciesId, ownerId, status: 'ACTIVE' })}`),
    enabled: open && (q.length >= 2 || browse),
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
          <span className="truncate">{value ? `${value.name} (${value.species.name}) · ${value.owner?.displayName ?? ''}` : placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={browse ? 'Filter…' : 'Type at least 2 characters…'}
            className="h-10 flex-1 bg-transparent text-sm outline-none"
            aria-label="Search patients"
          />
          {results.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {!browse && q.length < 2 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Search by name, owner, microchip or P-number</li>}
          {(browse || q.length >= 2) && !results.isFetching && rows.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">No active patients found</li>
          )}
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === r.id}
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn('h-4 w-4', value?.id === r.id ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.name} <span className="font-normal text-muted-foreground">· {r.species.name}{r.breed ? ` · ${r.breed}` : ''}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.patientNo} · {r.owner?.displayName ?? 'No owner'}
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
