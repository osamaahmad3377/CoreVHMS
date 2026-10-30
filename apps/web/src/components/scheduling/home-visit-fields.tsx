'use client';
import { useQuery } from '@tanstack/react-query';
import { Building2, House, MapPin } from 'lucide-react';
import { useEffect } from 'react';
import { Field } from '../forms/field';
import { Input, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import type { Address, ClientDetail, HomeVisitSettings } from '@/lib/types';
import { cn } from '@/lib/utils';

export type VisitLocation = 'CLINIC' | 'HOME';

export interface HomeVisitValue {
  visitAddress: string;
  visitDirections: string;
  visitMapUrl: string;
  /** '' = the clinic's usual travel time. */
  travelMinutes: number | '';
}

export const EMPTY_HOME_VISIT: HomeVisitValue = { visitAddress: '', visitDirections: '', visitMapUrl: '', travelMinutes: '' };

/** One line per saved address, as it is copied onto a home visit. */
export function addressText(a: Pick<Address, 'line1' | 'line2' | 'city' | 'state' | 'postcode'>) {
  return [a.line1, a.line2, a.city, [a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** Where to open the visit in a maps app: the client's pin when they shared one, else a search for the address. */
export function mapsHref(v: { visitAddress?: string | null; visitMapUrl?: string | null }) {
  if (v.visitMapUrl && /^https:\/\//i.test(v.visitMapUrl)) return v.visitMapUrl;
  return v.visitAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.visitAddress)}` : null;
}

export function useHomeVisitSettings(enabled = true) {
  return useQuery({ queryKey: ['home-visit-settings'], queryFn: () => api.get<HomeVisitSettings>('/home-visits/settings'), staleTime: 300_000, enabled });
}

/** "At the clinic" / "Home visit" switch. */
export function LocationSwitch({ value, onChange }: { value: VisitLocation; onChange: (v: VisitLocation) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where is the visit?">
      {(
        [
          ['CLINIC', 'At the clinic', Building2],
          ['HOME', 'Home visit', House],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted', value === v && 'border-primary bg-primary/10 font-medium text-primary')}
        >
          <Icon className="h-4 w-4" /> {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Address, directions, map pin and travel time for a home visit. The client's saved addresses can be picked with
 * one tap; the primary one is filled in when the address is still empty.
 */
export function HomeVisitFields({
  clientId,
  value,
  onChange,
  idPrefix = 'hv',
  defaultTravelMinutes,
}: {
  clientId?: string | null;
  value: HomeVisitValue;
  onChange: (v: HomeVisitValue) => void;
  idPrefix?: string;
  defaultTravelMinutes?: number;
}) {
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => api.get<ClientDetail>(`/clients/${clientId}`), enabled: !!clientId });
  const addresses = client.data?.addresses ?? [];
  useEffect(() => {
    if (!value.visitAddress && addresses.length) {
      const primary = addresses.find((a) => a.isPrimary) ?? addresses[0];
      onChange({ ...value, visitAddress: addressText(primary) });
    }
    // Only when the client's addresses arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.data]);
  const set = (patch: Partial<HomeVisitValue>) => onChange({ ...value, ...patch });
  const href = mapsHref(value);

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      {addresses.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Client’s saved addresses">
          {addresses.map((a) => {
            const text = addressText(a);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => set({ visitAddress: text })}
                className={cn('rounded border bg-card px-2 py-1 text-left text-xs hover:border-primary', value.visitAddress === text && 'border-primary bg-primary/10')}
              >
                {a.label || (a.isPrimary ? 'Main address' : 'Address')}: {a.line1}
              </button>
            );
          })}
        </div>
      )}
      <Field label="Visit address" htmlFor={`${idPrefix}-address`} required hint={!addresses.length && clientId && !client.isLoading ? 'This client has no saved address; type it here.' : undefined}>
        <Textarea id={`${idPrefix}-address`} rows={2} maxLength={500} placeholder="House, street, area, city" value={value.visitAddress} onChange={(e) => set({ visitAddress: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How to find it" htmlFor={`${idPrefix}-directions`}>
          <Input id={`${idPrefix}-directions`} maxLength={500} placeholder="e.g. green gate opposite the mosque" value={value.visitDirections} onChange={(e) => set({ visitDirections: e.target.value })} />
        </Field>
        <Field label="Map pin link" htmlFor={`${idPrefix}-map`} hint="Optional. A Google Maps link the client shared.">
          <Input id={`${idPrefix}-map`} type="url" inputMode="url" maxLength={500} placeholder="https://maps.app.goo.gl/…" value={value.visitMapUrl} onChange={(e) => set({ visitMapUrl: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Travel time (minutes)" htmlFor={`${idPrefix}-travel`} hint="Blocked on the vet’s calendar before the visit.">
          <Input
            id={`${idPrefix}-travel`}
            type="number"
            min={0}
            max={240}
            step={5}
            className="w-32"
            placeholder={defaultTravelMinutes !== undefined ? String(defaultTravelMinutes) : ''}
            value={value.travelMinutes}
            onChange={(e) => set({ travelMinutes: e.target.value === '' ? '' : Math.max(0, Math.min(240, Number(e.target.value))) })}
          />
        </Field>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <MapPin className="h-3.5 w-3.5" /> Check on the map
          </a>
        )}
      </div>
    </div>
  );
}
