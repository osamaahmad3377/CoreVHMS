'use client';
import { useQuery } from '@tanstack/react-query';
import type { Paginated } from '@vcms/shared';
import { Check, ChevronsUpDown, Loader2, Search, SearchX, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { api, qs } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { PatientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { QuickAddClientPatient } from './quick-add-client-patient';

export type PickedPatient = Pick<PatientRow, 'id' | 'name' | 'patientNo' | 'species' | 'owner' | 'alerts'>;

/** Searchable patient selector (patient name, client name or phone, microchip/tag, P-number). */
export function PatientPicker({
  value,
  onChange,
  excludeId,
  speciesId,
  ownerId,
  placeholder = 'Search by name, patient or phone (e.g. 0300 77…)',
  id,
  invalid,
  allowCreate,
}: {
  value: PickedPatient | null;
  onChange: (p: PickedPatient | null) => void;
  excludeId?: string;
  speciesId?: string;
  ownerId?: string;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  /** Offer "New client and patient" when the search finds nothing (front desk: walk-ins and bookings). */
  allowCreate?: boolean;
}) {
  const { can } = useSession();
  const canCreate = !!allowCreate && !ownerId && can('clients.write') && can('patients.write');
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  /** The search text the quick-add form started from; null while the form is closed. */
  const [creating, setCreating] = useState<string | null>(null);
  const startCreate = () => {
    setOpen(false);
    setCreating(term.trim());
  };
  const q = useDebounce(term.trim(), 250);
  const browse = !!ownerId;
  const results = useQuery({
    queryKey: ['patient-picker', q, speciesId, ownerId],
    queryFn: () => api.get<Paginated<PatientRow>>(`/patients${qs({ q: q || undefined, pageSize: 10, speciesId, ownerId, status: 'ACTIVE' })}`),
    enabled: open && (q.length >= 2 || browse),
  });
  const rows = (results.data?.data ?? []).filter((r) => r.id !== excludeId);

  if (creating !== null) {
    return (
      <QuickAddClientPatient
        seed={creating}
        onCancel={() => setCreating(null)}
        onCreated={(p) => {
          setCreating(null);
          setTerm('');
          onChange(p);
        }}
      />
    );
  }

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
          className={cn('w-full min-w-0 justify-between overflow-hidden font-normal', !value && 'text-muted-foreground', invalid && 'border-destructive')}
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
            placeholder={browse ? 'Filter…' : 'Name, client or phone — at least 2 characters'}
            className="h-10 flex-1 bg-transparent text-sm outline-none"
            aria-label="Search patients"
          />
          {results.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {!browse && q.length < 2 && (
            <li className="px-3 py-5 text-center text-xs text-muted-foreground">Type at least 2 letters of the pet’s or owner’s name, a phone number, microchip or P-number.</li>
          )}
          {(browse || q.length >= 2) && !results.isFetching && rows.length === 0 && (
            <li className="grid justify-items-center gap-2 px-4 py-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <SearchX className="h-5 w-5 text-muted-foreground" />
              </span>
              {q ? (
                <>
                  <span className="text-sm font-semibold">No patient matches “{q}”</span>
                  <span className="max-w-xs text-xs text-muted-foreground">Check the spelling or try the owner’s phone number.{canCreate ? ' If they are new to the clinic, register them now.' : ''}</span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">This client has no active patients.</span>
              )}
              {canCreate && q && (
                <Button type="button" size="sm" className="mt-1" onClick={startCreate}>
                  <UserPlus /> Add “{q.length > 24 ? `${q.slice(0, 24)}…` : q}” as a new patient
                </Button>
              )}
            </li>
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
                    {[r.patientNo, r.owner?.displayName ?? 'No client', r.owner?.mobilePhone].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {canCreate && (
          // Always in view: a new client and their pet can be registered without leaving the form.
          <button type="button" onClick={startCreate} className="flex w-full items-center gap-3 border-t bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.06] focus-visible:bg-primary/[0.06] focus-visible:outline-none">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-primary">New client and patient</span>
              <span className="block truncate text-xs text-muted-foreground">Register the owner and their pet now</span>
            </span>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
