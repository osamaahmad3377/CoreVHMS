'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { branchSchema } from '@vcms/shared';
import { Building2, Edit, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, applyServerErrors } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { EmptyState } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { limitNote, usePlanUsage } from '@/hooks/use-plan-usage';
import { useSession } from '@/lib/session';
import type { Branch } from '@/lib/types';

const TIMEZONES = ['Asia/Karachi', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Hobart', 'Australia/Darwin', 'UTC'];

function BranchDialog({ branch, open, onOpenChange }: { branch?: Branch | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
    values: {
      name: branch?.name ?? '',
      code: branch?.code ?? '',
      timezone: branch?.timezone ?? (session.organization?.country === 'AU' ? 'Australia/Sydney' : 'Asia/Karachi'),
      email: branch?.email ?? '',
      phone: branch?.phone ?? '',
      addressLine1: branch?.addressLine1 ?? '',
      addressLine2: branch?.addressLine2 ?? '',
      city: branch?.city ?? '',
      state: branch?.state ?? '',
      postcode: branch?.postcode ?? '',
      isActive: branch?.isActive ?? true,
    },
  });
  const e = form.formState.errors;
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (branch) await api.patch(`/branches/${branch.id}`, v);
      else await api.post('/branches', v);
      toast.success(branch ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['branches'] });
      refresh();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) applyServerErrors(err.fieldErrors, form.setError);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : 'Add branch'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Branch name" htmlFor="b-name" error={e.name} required>
              <Input id="b-name" {...form.register('name')} />
            </Field>
            <Field label="Code" htmlFor="b-code" error={e.code} required hint="Used in numbering">
              <Input id="b-code" className="uppercase" {...form.register('code')} />
            </Field>
          </div>
          <Field label="Timezone" htmlFor="b-tz" error={e.timezone} required>
            <NativeSelect id="b-tz" {...form.register('timezone')}>
              {TIMEZONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" htmlFor="b-email" error={e.email}>
              <Input id="b-email" {...form.register('email')} />
            </Field>
            <Field label="Phone" htmlFor="b-phone" error={e.phone}>
              <Input id="b-phone" {...form.register('phone')} />
            </Field>
            <Field label="Address" htmlFor="b-a1">
              <Input id="b-a1" {...form.register('addressLine1')} />
            </Field>
            <Field label="City" htmlFor="b-city">
              <Input id="b-city" {...form.register('city')} />
            </Field>
          </div>
          {branch && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!isActive} onCheckedChange={(v) => form.setValue('isActive', v === true)} /> Branch is active
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BranchesPage() {
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/branches') });
  const [dlg, setDlg] = useState<{ open: boolean; branch?: Branch | null }>({ open: false });
  const plan = usePlanUsage();
  return (
    <RequirePermission anyOf={['branches.manage']}>
      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <div className="flex items-center gap-2">
            {plan.branches.max !== null && (
              <span className={`text-xs ${plan.branches.canAdd ? 'text-muted-foreground' : 'font-medium text-warning'}`} title="Paused branches do not count">
                {limitNote(plan.branches, 'branches')}{!plan.branches.canAdd && ' — full'}
              </span>
            )}
            <Button size="sm" disabled={!plan.branches.canAdd} title={plan.branches.canAdd ? undefined : `Your ${plan.plan ?? ''} plan allows ${plan.branches.max} branch${plan.branches.max === 1 ? '' : 'es'}. Pause one you no longer use or ask NextCore for a bigger plan.`} onClick={() => setDlg({ open: true, branch: null })}>
              <Plus /> Add branch
            </Button>
          </div>
        </CardHeader>
        <DataTable
          query={q}
          rowKey={(b) => b.id}
          empty={<EmptyState icon={Building2} title="No branches" />}
          columns={[
            { key: 'name', header: 'Branch', cell: (b) => <span className="font-medium">{b.name}</span> },
            { key: 'code', header: 'Code', cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
            { key: 'tz', header: 'Timezone', cell: (b) => <span className="text-sm text-muted-foreground">{b.timezone}</span> },
            { key: 'contact', header: 'Contact', cell: (b) => <span className="text-sm">{[b.phone, b.city].filter(Boolean).join(' · ') || '—'}</span> },
            { key: 'staff', header: 'Staff', cell: (b) => <span className="tabular">{b._count?.members ?? 0}</span> },
            { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.isActive ? 'ACTIVE' : 'ARCHIVED'} /> },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              cell: (b) => (
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${b.name}`} onClick={() => setDlg({ open: true, branch: b })}>
                  <Edit />
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <BranchDialog branch={dlg.branch} open={dlg.open} onOpenChange={(open) => setDlg({ open })} />
    </RequirePermission>
  );
}
