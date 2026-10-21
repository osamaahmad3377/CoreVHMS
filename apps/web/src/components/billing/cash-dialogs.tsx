'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromMinor } from '@vcms/shared';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { MoneyInput, parseMoney } from './money';
import { api } from '@/lib/api';
import { fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CashExpected, CashRegister } from '@/lib/types';

/** Notes in the drawer, largest first (minor units). Other currencies count coins and notes as one amount. */
const NOTES: Record<string, number[]> = {
  PKR: [500000, 100000, 50000, 10000, 5000, 2000, 1000],
  AUD: [10000, 5000, 2000, 1000, 500],
};

/** Optional helper: count each note and the coins, and the total becomes the counted cash. */
function NoteCounter({ currency, onTotal }: { currency: string; onTotal: (minor: number) => void }) {
  const notes = NOTES[currency] ?? [];
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('');
  const total = notes.reduce((n, v) => n + v * (Number(counts[v]) || 0), 0) + (parseMoney(coins, currency) ?? 0);
  useEffect(() => onTotal(total), [total, onTotal]);
  return (
    <div className="grid gap-1.5 rounded-lg surface-flat p-3">
      {notes.map((v) => (
        <div key={v} className="grid grid-cols-[1fr_80px_1fr] items-center gap-2 text-sm">
          <label htmlFor={`note-${v}`} className="tabular">{fmtMoney(v, currency).replace(/\.00$/, '')} notes ×</label>
          <Input id={`note-${v}`} inputMode="numeric" className="h-8 text-right tabular" value={counts[v] ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [v]: e.target.value.replace(/\D/g, '') }))} />
          <span className="text-right text-muted-foreground tabular">{fmtMoney(v * (Number(counts[v]) || 0), currency)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_minmax(0,1fr)] items-center gap-2 text-sm">
        <label htmlFor="note-coins">{notes.length ? 'Coins (total)' : 'Notes and coins (total)'}</label>
        <MoneyInput id="note-coins" currency={currency} className="h-8" value={coins} onChange={(e) => setCoins(e.target.value)} />
      </div>
      <p className="flex justify-between border-t pt-1.5 text-sm font-semibold"><span>Total counted</span><span className="tabular">{fmtMoney(total, currency)}</span></p>
    </div>
  );
}

export function CloseDrawerDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const fromCounter = useCallback((minor: number) => setCounted(fromMinor(minor, currency)), [currency]);
  const exp = useQuery({ queryKey: ['cash', 'expected', sessionId], queryFn: () => api.get<CashExpected>(`/cash/sessions/${sessionId}`), enabled: !!sessionId });
  useEffect(() => { setCounted(''); setNotes(''); setError(null); setCounting(false); }, [sessionId]);
  const countedMinor = parseMoney(counted, currency);
  const variance = countedMinor !== null && exp.data ? countedMinor - exp.data.expectedCashMinor : null;
  const m = useMutation({
    mutationFn: () => api.post(`/cash/sessions/${sessionId}/close`, { countedCashMinor: countedMinor, notes: notes || null }),
    onSuccess: () => { toast.success('Cash drawer closed'); qc.invalidateQueries({ queryKey: ['cash'] }); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  const d = exp.data;
  return (
    <Dialog open={!!sessionId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Close cash drawer</DialogTitle>
          <DialogDescription>Count the cash in the drawer. If it is different from what should be there, write why.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {d && (
          <dl className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex justify-between"><dt>Starting cash</dt><dd className="tabular">{fmtMoney(d.session.openingFloatMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt>Cash received</dt><dd className="tabular">+{fmtMoney(d.cashInMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt>Cash refunds</dt><dd className="tabular">−{fmtMoney(d.refundsMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt>Paid out (expenses)</dt><dd className="tabular">−{fmtMoney(d.paidOutMinor, currency)}</dd></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><dt>Should be in drawer</dt><dd className="tabular">{fmtMoney(d.expectedCashMinor, currency)}</dd></div>
          </dl>
        )}
        <Field label="Counted cash" htmlFor="cs-counted" required>
          <MoneyInput id="cs-counted" currency={currency} value={counted} readOnly={counting} onChange={(e) => setCounted(e.target.value)} />
        </Field>
        <Button type="button" variant="ghost" size="sm" className="-mt-2 justify-self-start" aria-expanded={counting} onClick={() => setCounting((c) => !c)}>
          {counting ? 'Hide note count' : 'Help me count (notes and coins)'}
        </Button>
        {counting && <NoteCounter currency={currency} onTotal={fromCounter} />}
        {variance !== null && variance !== 0 && <p className={`text-sm font-medium ${variance < 0 ? 'text-destructive' : 'text-warning'}`}>Difference: {variance < 0 ? 'short' : 'over'} by {fmtMoney(Math.abs(variance), currency)}</p>}
        <Field label={variance ? 'Why is there a difference? (required)' : 'Notes'} htmlFor="cs-notes" required={!!variance}>
          <Textarea id="cs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={countedMinor === null || (!!variance && !notes.trim())} onClick={() => { setError(null); m.mutate(); }}>Close cash drawer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Start of the day (or shift): choose the cash drawer and enter the starting cash. */
export function OpenDrawerDialog({ open, onOpenChange, registers, onOpened }: { open: boolean; onOpenChange: (o: boolean) => void; registers: CashRegister[]; onOpened?: () => void }) {
  const qc = useQueryClient();
  const { currency } = useSession();
  const free = registers.filter((r) => !r.sessions.length);
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setRegisterId(free[0]?.id ?? '');
      setFloat('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.post('/cash/sessions', { registerId, openingFloatMinor: parseMoney(float || '0', currency) ?? 0 }),
    onSuccess: () => {
      toast.success('Cash drawer opened');
      qc.invalidateQueries({ queryKey: ['cash'] });
      onOpenChange(false);
      onOpened?.();
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Open cash drawer</DialogTitle>
          <DialogDescription>Count the cash that is in the drawer now and enter it as the starting cash. The drawer is counted again when you close it.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {free.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">Every cash drawer here is already open. Close one first, or ask your manager to add another.</p>
        ) : (
          <div className="grid gap-3">
            {free.length > 1 && (
              <Field label="Cash drawer" htmlFor="od-reg">
                <NativeSelect id="od-reg" value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
                  {free.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="Starting cash" htmlFor="od-float">
              <MoneyInput id="od-float" autoFocus currency={currency} value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!registerId || free.length === 0} onClick={() => { setError(null); m.mutate(); }}>Open cash drawer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
