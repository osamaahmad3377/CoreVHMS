'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromMinor } from '@vcms/shared';
import { Landmark, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CloseDrawerDialog } from '@/components/billing/cash-dialogs';
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
      <CloseDrawerDialog sessionId={closing} onClose={() => setClosing(null)} />
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
