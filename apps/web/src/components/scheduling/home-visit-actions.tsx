'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Car, House, MapPin, MapPinCheck, Phone, Route } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { mapsHref } from './home-visit-fields';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { branchTime } from '@/lib/time';
import type { Appointment } from '@/lib/types';

const OPEN = ['BOOKED', 'CONFIRMED'];

/** Address, directions, travel and progress of a home visit, with a link to open it in a maps app. */
export function HomeVisitInfo({ a, tz }: { a: Appointment; tz: string }) {
  const href = mapsHref(a);
  const steps = [
    a.travelStartsAt && `Leaves ${branchTime(a.travelStartsAt, tz)} (${a.travelMinutes} min travel)`,
    a.onTheWayAt && `On the way ${branchTime(a.onTheWayAt, tz)}`,
    a.arrivedAt && `Arrived ${branchTime(a.arrivedAt, tz)}`,
    a.distanceKm != null && `${a.distanceKm} km`,
  ].filter(Boolean);
  return (
    <div className="grid gap-1.5 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <p className="flex items-start gap-2 font-medium">
        <House className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Home visit — <span className="whitespace-pre-line font-normal">{a.visitAddress}</span>
        </span>
      </p>
      {a.visitDirections && <p className="pl-6 text-muted-foreground">How to find it: {a.visitDirections}</p>}
      {steps.length > 0 && <p className="pl-6 text-xs text-muted-foreground">{steps.join(' · ')}</p>}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex w-fit items-center gap-1 pl-6 text-xs font-medium text-primary hover:underline">
          <MapPin className="h-3.5 w-3.5" /> Open in Google Maps
        </a>
      )}
    </div>
  );
}

function kmValue(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 2000 ? Math.round(n * 10) / 10 : NaN;
}

/**
 * The vet's buttons for a home visit: on the way (optionally telling the client), arrived (the call-out fee goes on the
 * bill), and the distance travelled.
 */
export function HomeVisitActions({ a, onDone }: { a: Appointment; onDone?: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<null | 'way' | 'arrived' | 'distance'>(null);
  const [notify, setNotify] = useState(true);
  const [km, setKm] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setNotify(true);
    setKm(a.distanceKm != null ? String(a.distanceKm) : '');
  }, [dlg, a.distanceKm]);

  const allowed = can('appointments.checkin') || can('clinical.write');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['appointment', a.id] });
    qc.invalidateQueries({ queryKey: ['home-visits'] });
    qc.invalidateQueries({ queryKey: ['queue'] });
    onDone?.();
  };
  const who = a.patient?.name ?? a.client.displayName;
  const run = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: unknown; method?: 'put' }) =>
      method === 'put' ? api.put<Appointment>(`/home-visits/${a.id}/${path}`, body) : api.post<Appointment>(`/home-visits/${a.id}/${path}`, body),
    onSuccess: (_r, v) => {
      toast.success(v.path === 'on-the-way' ? `On the way to ${who}${notify ? ' — the client has been told' : ''}` : v.path === 'arrived' ? `Arrived at ${who}’s home` : 'Distance saved');
      setDlg(null);
      refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!allowed || a.location !== 'HOME') return null;
  const size = 'sm';
  const kmParsed = kmValue(km);
  const showWay = OPEN.includes(a.status) && !a.onTheWayAt && !a.arrivedAt;
  const showArrived = [...OPEN, 'IN_CONSULTATION'].includes(a.status) && !a.arrivedAt;
  const showDistance = !['CANCELLED', 'NO_SHOW'].includes(a.status) && (!!a.arrivedAt || a.status === 'COMPLETED');

  return (
    <>
      {a.client.mobilePhone && (
        <Button size={size} variant="outline" asChild>
          <a href={`tel:${a.client.mobilePhone.replace(/[^\d+]/g, '')}`}>
            <Phone /> Call client
          </a>
        </Button>
      )}
      {showWay && (
        <Button size={size} variant={a.onTheWayAt ? 'outline' : 'default'} onClick={() => setDlg('way')}>
          <Car /> On the way
        </Button>
      )}
      {showArrived && (
        <Button size={size} variant={a.onTheWayAt ? 'default' : 'outline'} onClick={() => setDlg('arrived')}>
          <MapPinCheck /> Arrived
        </Button>
      )}
      {showDistance && (
        <Button size={size} variant="outline" onClick={() => setDlg('distance')}>
          <Route /> {a.distanceKm != null ? `${a.distanceKm} km` : 'Record distance'}
        </Button>
      )}

      <Dialog open={dlg === 'way'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Setting off to {who}?</DialogTitle>
            <DialogDescription>{a.visitAddress}</DialogDescription>
          </DialogHeader>
          {error && <FormError message={error} />}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} className="mt-0.5" />
            <span>
              Tell the client the vet is on the way
              <span className="block text-xs text-muted-foreground">By WhatsApp or email, as set in Settings → Client notifications.</span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button loading={run.isPending} onClick={() => run.mutate({ path: 'on-the-way', body: { notifyClient: notify } })}>
              <Car /> On the way
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dlg === 'arrived' || dlg === 'distance'} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{dlg === 'arrived' ? `Arrived at ${who}’s home?` : 'Distance travelled'}</DialogTitle>
            <DialogDescription>
              {dlg === 'arrived' ? 'The home visit call-out fee is added to the client’s bill.' : 'The travel charge follows the distance until it is on an invoice.'}
            </DialogDescription>
          </DialogHeader>
          {error && <FormError message={error} />}
          <Field label="Distance travelled (km)" htmlFor="hv-km" required={dlg === 'distance'} hint={dlg === 'arrived' ? 'Optional. You can add it later.' : undefined} error={Number.isNaN(kmParsed) ? 'Enter a number from 0 to 2000' : undefined}>
            <Input id="hv-km" type="number" inputMode="decimal" min={0} max={2000} step={0.1} value={km} onChange={(e) => setKm(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            {dlg === 'arrived' ? (
              <Button loading={run.isPending} disabled={Number.isNaN(kmParsed)} onClick={() => run.mutate({ path: 'arrived', body: { distanceKm: kmParsed } })}>
                <MapPinCheck /> Arrived
              </Button>
            ) : (
              <Button loading={run.isPending} disabled={kmParsed === null || Number.isNaN(kmParsed)} onClick={() => run.mutate({ path: 'distance', body: { distanceKm: kmParsed }, method: 'put' })}>
                Save distance
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
