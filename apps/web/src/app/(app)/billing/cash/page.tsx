'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromMinor } from '@vcms/shared';
import { Landmark, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { CommerceBadge } from '@/components/billing/status';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { CashExpected, CashRegister, CashSession } from '@/lib/types';

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
    <div className="grid gap-1.5 rounded-md border p-3">
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

function CloseDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
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

function Cash() {
  const qc = useQueryClient();
  const { session, currency, can } = useSession();
  const [closing, setClosing] = useState<string | null>(null);
  const [floats, setFloats] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const registers = useQuery({ queryKey: ['cash', 'registers'], queryFn: () => api.get<CashRegister[]>('/cash/registers') });
  const sessions = useQuery({ queryKey: ['cash', 'sessions'], queryFn: () => api.get<CashSession[]>('/cash/sessions') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash'] });
  const open = useMutation({
    mutationFn: (registerId: string) => api.post('/cash/sessions', { registerId, openingFloatMinor: parseMoney(floats[registerId] ?? '0', currency) ?? 0 }),
    onSuccess: () => { toast.success('Cash drawer opened'); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: () => api.post('/cash/registers', { branchId: session.branch?.id, name: newName }),
    onSuccess: () => { setNewName(''); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        help="cash" title="Cash drawer" description="Each morning enter the starting cash. Each evening count the drawer." />
      <SectionNav links={BILLING_LINKS} />
      <div className="grid gap-4 lg:grid-cols-3">
        {(registers.data ?? []).map((r) => {
          const s = r.sessions[0];
          return (
            <Card key={r.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Landmark className="h-4 w-4 text-muted-foreground" /> {r.name}</CardTitle>
                <CommerceBadge status={s ? 'OPEN' : 'CLOSED'} />
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-xs text-muted-foreground">{r.branch.name}</p>
                {s ? (
                  <>
                    <p className="text-sm">Opened {fmtDateTime(s.openedAt)} by {s.openedByName} · starting cash {fmtMoney(s.openingFloatMinor, currency)}</p>
                    <Button size="sm" onClick={() => setClosing(s.id)}>End of day: count cash</Button>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <MoneyInput aria-label={`Starting cash for ${r.name}`} currency={currency} value={floats[r.id] ?? ''} onChange={(e) => setFloats((f) => ({ ...f, [r.id]: e.target.value }))} placeholder="Starting cash" />
                    <Button size="sm" loading={open.isPending && open.variables === r.id} onClick={() => open.mutate(r.id)}>Open drawer</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {can('cash.manage') && (
          <Card>
            <CardHeader><CardTitle>Add cash drawer</CardTitle></CardHeader>
            <CardContent className="flex gap-2">
              <Input aria-label="Cash drawer name" placeholder={`e.g. Reception (${session.branch?.name ?? 'branch'})`} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
              <Button size="sm" variant="outline" disabled={!newName.trim() || !session.branch} loading={create.isPending} onClick={() => create.mutate()}><Plus /> Add</Button>
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Past days</CardTitle></CardHeader>
        <DataTable
          query={sessions}
          rowKey={(s) => s.id}
          empty={<EmptyState title="No days yet" />}
          columns={[
            { key: 'reg', header: 'Cash drawer', cell: (s) => <span className="text-sm">{s.register?.name}</span> },
            { key: 'open', header: 'Opened', cell: (s) => <span className="text-xs">{fmtDateTime(s.openedAt)}<span className="block text-muted-foreground">{s.openedByName}</span></span> },
            { key: 'close', header: 'Closed', cell: (s) => <span className="text-xs">{s.closedAt ? <>{fmtDateTime(s.closedAt)}<span className="block text-muted-foreground">{s.closedByName}</span></> : '—'}</span> },
            { key: 'float', header: 'Starting cash', className: 'text-right tabular', headerClassName: 'text-right', cell: (s) => fmtMoney(s.openingFloatMinor, currency) },
            { key: 'exp', header: 'Should be', className: 'text-right tabular', headerClassName: 'text-right', cell: (s) => (s.expectedCashMinor != null ? fmtMoney(s.expectedCashMinor, currency) : '—') },
            { key: 'count', header: 'Counted', className: 'text-right tabular', headerClassName: 'text-right', cell: (s) => (s.countedCashMinor != null ? fmtMoney(s.countedCashMinor, currency) : '—') },
            { key: 'var', header: 'Difference', className: 'text-right tabular', headerClassName: 'text-right', cell: (s) => (s.varianceMinor != null ? <span className={s.varianceMinor ? 'font-medium text-destructive' : ''} title={s.notes ?? undefined}>{fmtMoney(s.varianceMinor, currency)}</span> : '—') },
            { key: 'st', header: 'Status', cell: (s) => <CommerceBadge status={s.status} /> },
          ]}
        />
      </Card>
      <CloseDialog sessionId={closing} onClose={() => setClosing(null)} />
    </>
  );
}

export default function CashPage() {
  return (
    <RequirePermission anyOf={['cash.manage']}>
      <Cash />
    </RequirePermission>
  );
}
