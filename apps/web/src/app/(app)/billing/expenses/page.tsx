'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, enumLabel } from '@vcms/shared';
import { Plus, ReceiptText } from 'lucide-react';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { MoneyInput, parseMoney } from '@/components/billing/money';
import { BILLING_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { todayIn } from '@/lib/time';
import type { Expense, Supplier } from '@/lib/types';

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { currency, session } = useSession();
  const blank = () => ({ date: todayIn(session.branch?.timezone ?? 'UTC'), category: 'OTHER', description: '', amount: '', tax: '', method: 'BANK_TRANSFER', supplierId: '', reference: '' });
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: open });
  const set = (k: keyof ReturnType<typeof blank>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: () => api.post('/expenses', { date: f.date, category: f.category, description: f.description, amountMinor: parseMoney(f.amount, currency), taxMinor: parseMoney(f.tax, currency) ?? 0, method: f.method, supplierId: f.supplierId || null, reference: f.reference || null }),
    onSuccess: () => { toast.success('Expense recorded'); qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['cash'] }); setF(blank()); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record expense</DialogTitle>
          <DialogDescription>Cash expenses are paid out of the open register for this branch.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="ex-date" required><Input id="ex-date" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Category" htmlFor="ex-cat" required>
            <NativeSelect id="ex-cat" value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{enumLabel(c)}</option>)}</NativeSelect>
          </Field>
          <Field label="Description" htmlFor="ex-desc" required className="sm:col-span-2"><Input id="ex-desc" value={f.description} onChange={set('description')} maxLength={300} /></Field>
          <Field label="Amount (incl. tax)" htmlFor="ex-amt" required><MoneyInput id="ex-amt" currency={currency} value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Of which tax" htmlFor="ex-tax"><MoneyInput id="ex-tax" currency={currency} value={f.tax} onChange={set('tax')} /></Field>
          <Field label="Paid by" htmlFor="ex-method" required>
            <NativeSelect id="ex-method" value={f.method} onChange={set('method')}>{PAYMENT_METHODS.map((p) => <option key={p} value={p}>{enumLabel(p)}</option>)}</NativeSelect>
          </Field>
          <Field label="Supplier" htmlFor="ex-sup" required={f.category === 'SUPPLIER_PAYMENT'}>
            <NativeSelect id="ex-sup" value={f.supplierId} onChange={set('supplierId')}>
              <option value="">None</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="ex-ref" className="sm:col-span-2"><Input id="ex-ref" value={f.reference} onChange={set('reference')} maxLength={120} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={m.isPending} disabled={!f.description.trim() || !parseMoney(f.amount, currency)} onClick={() => { setError(null); m.mutate(); }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Expenses() {
  const { can, currency } = useSession();
  const [create, setCreate] = useState(false);
  const query = useQuery({ queryKey: ['expenses'], queryFn: () => api.get<Expense[]>(`/expenses${qs({})}`) });
  const total = (query.data ?? []).reduce((n, e) => n + e.amountMinor, 0);
  return (
    <>
      <PageHeader title="Expenses" breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Expenses' }]} actions={can('expenses.write') && <Button size="sm" onClick={() => setCreate(true)}><Plus /> Record expense</Button>} />
      <SectionNav links={BILLING_LINKS} />
      <Card>
        {!!query.data?.length && <p className="border-b p-3 text-sm text-muted-foreground">Showing the latest {query.data.length} · total <b className="tabular text-foreground">{fmtMoney(total, currency)}</b></p>}
        <DataTable
          query={query}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={ReceiptText} title="No expenses recorded" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => <span className="whitespace-nowrap text-sm">{fmtDate(r.date)}</span> },
            { key: 'cat', header: 'Category', cell: (r) => <span className="text-sm">{enumLabel(r.category)}</span> },
            { key: 'desc', header: 'Description', cell: (r) => <span className="text-sm">{r.description}{r.supplier && <span className="block text-xs text-muted-foreground">{r.supplier.name}</span>}</span> },
            { key: 'method', header: 'Paid by', cell: (r) => <span className="text-sm">{enumLabel(r.method)}{r.reference && <span className="block text-xs text-muted-foreground">{r.reference}</span>}</span> },
            { key: 'by', header: 'Recorded by', cell: (r) => <span className="text-xs">{r.createdByName}</span> },
            { key: 'amt', header: 'Amount', className: 'text-right tabular', headerClassName: 'text-right', cell: (r) => <span>{fmtMoney(r.amountMinor, currency)}{!!r.taxMinor && <span className="block text-xs text-muted-foreground">tax {fmtMoney(r.taxMinor, currency)}</span>}</span> },
          ]}
        />
      </Card>
      <ExpenseDialog open={create} onOpenChange={setCreate} />
    </>
  );
}

export default function ExpensesPage() {
  return (
    <RequirePermission anyOf={['expenses.write', 'reports.financial']}>
      <Suspense><Expenses /></Suspense>
    </RequirePermission>
  );
}
