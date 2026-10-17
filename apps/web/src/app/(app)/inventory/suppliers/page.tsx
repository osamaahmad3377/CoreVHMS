'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supplierSchema } from '@vcms/shared';
import { Plus, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { INVENTORY_LINKS, SectionNav } from '@/components/billing/section-nav';
import { DataTable } from '@/components/data-table';
import { Field, applyServerErrors } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState, PageHeader } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Supplier } from '@/lib/types';

interface SupplierAccount { supplier: Supplier; receivedMinor: number; paidMinor: number; returnedMinor: number; balanceMinor: number; receipts: { id: string; receiptNo: string; receivedAt: string; totalMinor: number; supplierInvoiceNo: string | null }[] }

type FormValues = { name: string; contactName: string; email: string; phone: string; address: string; taxNumber: string; paymentTermsDays: number; notes: string; isActive: boolean };

function SupplierDialog({ supplier, open, onOpenChange }: { supplier: Supplier | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { can, currency } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(supplierSchema) as any });
  const account = useQuery({ queryKey: ['supplier', supplier?.id], queryFn: () => api.get<SupplierAccount>(`/suppliers/${supplier!.id}`), enabled: open && !!supplier && (can('procurement.read') || can('reports.financial')) });
  useEffect(() => {
    if (open) {
      setError(null);
      form.reset({ name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', email: supplier?.email ?? '', phone: supplier?.phone ?? '', address: supplier?.address ?? '', taxNumber: supplier?.taxNumber ?? '', paymentTermsDays: supplier?.paymentTermsDays ?? 30, notes: supplier?.notes ?? '', isActive: supplier?.isActive ?? true });
    }
  }, [open, supplier, form]);
  const m = useMutation({
    mutationFn: (v: FormValues) => (supplier ? api.patch(`/suppliers/${supplier.id}`, v) : api.post('/suppliers', v)),
    onSuccess: () => { toast.success('Supplier saved'); qc.invalidateQueries({ queryKey: ['suppliers'] }); onOpenChange(false); },
    onError: (e: Error) => { if (e instanceof ApiError) applyServerErrors(e.fieldErrors, form.setError); setError(e.message); },
  });
  const editable = can('procurement.write');
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{supplier ? supplier.name : 'New supplier'}</DialogTitle>
          <DialogDescription>Supplier details, and the account balance: goods received, less supplier payments and goods returned.</DialogDescription>
        </DialogHeader>
        {error && <FormError message={error} />}
        {account.data && (
          <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Goods received</dt><dd className="font-medium tabular">{fmtMoney(account.data.receivedMinor, currency)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Paid (expenses)</dt><dd className="font-medium tabular">{fmtMoney(account.data.paidMinor, currency)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Returned</dt><dd className="font-medium tabular">{fmtMoney(account.data.returnedMinor, currency)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Balance owed</dt><dd className="font-semibold tabular">{fmtMoney(account.data.balanceMinor, currency)}</dd></div>
            {!!account.data.receipts.length && <p className="col-span-2 text-xs sm:col-span-4 text-muted-foreground">Recent: {account.data.receipts.slice(0, 5).map((r) => `${r.receiptNo} ${fmtDate(r.receivedAt)} ${fmtMoney(r.totalMinor, currency)}`).join(' · ')}</p>}
          </dl>
        )}
        <form id="supplier-form" className="grid gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <fieldset disabled={!editable} className="contents">
            <Field label="Name" htmlFor="sp-name" required error={e.name} className="sm:col-span-2"><Input id="sp-name" {...form.register('name')} /></Field>
            <Field label="Contact person" htmlFor="sp-contact" error={e.contactName}><Input id="sp-contact" {...form.register('contactName')} /></Field>
            <Field label="Phone" htmlFor="sp-phone" error={e.phone}><Input id="sp-phone" {...form.register('phone')} /></Field>
            <Field label="Email" htmlFor="sp-email" error={e.email}><Input id="sp-email" type="email" {...form.register('email')} /></Field>
            <Field label="Tax number" htmlFor="sp-tax" error={e.taxNumber}><Input id="sp-tax" {...form.register('taxNumber')} /></Field>
            <Field label="Payment terms (days)" htmlFor="sp-terms" error={e.paymentTermsDays}><Input id="sp-terms" inputMode="numeric" {...form.register('paymentTermsDays')} /></Field>
            <Field label="Address" htmlFor="sp-addr" error={e.address} className="sm:col-span-2"><Input id="sp-addr" {...form.register('address')} /></Field>
            <Field label="Notes" htmlFor="sp-notes" error={e.notes} className="sm:col-span-2"><Textarea id="sp-notes" {...form.register('notes')} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register('isActive')} /> Active</label>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {editable && <Button type="submit" form="supplier-form" loading={m.isPending}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Suppliers() {
  const { can } = useSession();
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const query = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.get<Supplier[]>('/suppliers?all=true') });
  return (
    <>
      <PageHeader title="Suppliers" actions={can('procurement.write') && <Button size="sm" onClick={() => setEditing(null)}><Plus /> New supplier</Button>} />
      <SectionNav links={INVENTORY_LINKS} />
      <Card>
        <DataTable
          query={query}
          rowKey={(s) => s.id}
          onRowClick={(s) => setEditing(s)}
          empty={<EmptyState icon={Truck} title="No suppliers yet" />}
          columns={[
            { key: 'name', header: 'Supplier', cell: (s) => <span className="font-medium">{s.name}</span> },
            { key: 'contact', header: 'Contact', cell: (s) => <span className="text-sm">{[s.contactName, s.phone, s.email].filter(Boolean).join(' · ') || '—'}</span> },
            { key: 'terms', header: 'Terms', cell: (s) => `${s.paymentTermsDays} days` },
            { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
          ]}
        />
      </Card>
      <SupplierDialog supplier={editing ?? null} open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
    </>
  );
}

export default function SuppliersPage() {
  return (
    <RequirePermission anyOf={['procurement.read', 'inventory.read']}>
      <Suppliers />
    </RequirePermission>
  );
}
