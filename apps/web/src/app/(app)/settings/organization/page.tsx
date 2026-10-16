'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationUpdateSchema } from '@vcms/shared';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Field, FormSection, applyServerErrors } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { ErrorState, LoadingRows } from '@/components/page';
import { RequirePermission } from '@/components/require';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Org {
  id: string;
  name: string;
  legalName: string | null;
  registrationNumber: string | null;
  taxNumber: string | null;
  country: string;
  currency: string;
  defaultTimezone: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  primaryColor: string | null;
  dateFormat: string;
  weightUnit: string;
  temperatureUnit: string;
  logoAttachmentId: string | null;
}

function OrgForm({ org }: { org: Org }) {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const form = useForm<z.input<typeof organizationUpdateSchema>>({
    resolver: zodResolver(organizationUpdateSchema),
    defaultValues: {
      name: org.name,
      legalName: org.legalName ?? '',
      registrationNumber: org.registrationNumber ?? '',
      taxNumber: org.taxNumber ?? '',
      email: org.email ?? '',
      phone: org.phone ?? '',
      website: org.website ?? '',
      addressLine1: org.addressLine1 ?? '',
      addressLine2: org.addressLine2 ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      postcode: org.postcode ?? '',
      dateFormat: org.dateFormat as any,
      weightUnit: org.weightUnit as any,
      temperatureUnit: org.temperatureUnit as any,
    },
  });
  const e = form.formState.errors;
  const save = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.patch('/organization', v);
      toast.success('Organization updated');
      qc.invalidateQueries({ queryKey: ['organization'] });
      refresh();
    } catch (err) {
      if (err instanceof ApiError) applyServerErrors(err.fieldErrors, form.setError);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  });
  const logo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('entityType', 'Organization');
      fd.append('entityId', org.id);
      fd.append('category', 'logo');
      fd.append('file', file);
      const a = await api.upload<{ id: string }>('/attachments', fd);
      await api.post('/organization/logo', { attachmentId: a.id });
    },
    onSuccess: () => {
      toast.success('Logo updated');
      setLogoVersion((v) => v + 1);
      qc.invalidateQueries({ queryKey: ['receipt-settings'] });
      qc.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <form onSubmit={save} className="grid gap-6" noValidate>
      {error && <FormError message={error} />}
      <FormSection title="Branding" description="Shown on invoices, certificates and printed documents.">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {org.logoAttachmentId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/v1/organization/logo?v=${logoVersion}`} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) logo.mutate(f); ev.target.value = ''; }} />
          <Button type="button" variant="outline" size="sm" onClick={() => logoRef.current?.click()} loading={logo.isPending}>
            <Upload /> Upload logo
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Practice name" htmlFor="name" error={e.name} required>
            <Input id="name" {...form.register('name')} />
          </Field>
          <Field label="Legal name" htmlFor="legalName" error={e.legalName}>
            <Input id="legalName" {...form.register('legalName')} />
          </Field>
          <Field label="Registration no." htmlFor="reg" error={e.registrationNumber}>
            <Input id="reg" {...form.register('registrationNumber')} />
          </Field>
          <Field label={org.country === 'AU' ? 'ABN' : 'NTN / STRN'} htmlFor="tax" error={e.taxNumber}>
            <Input id="tax" {...form.register('taxNumber')} />
          </Field>
        </div>
      </FormSection>
      <FormSection title="Contact" description="Public contact details for documents and client messages.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="email" error={e.email}>
            <Input id="email" type="email" {...form.register('email')} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={e.phone}>
            <Input id="phone" {...form.register('phone')} />
          </Field>
          <Field label="Website" htmlFor="web" error={e.website}>
            <Input id="web" {...form.register('website')} />
          </Field>
          <div />
          <Field label="Address line 1" htmlFor="a1">
            <Input id="a1" {...form.register('addressLine1')} />
          </Field>
          <Field label="Address line 2" htmlFor="a2">
            <Input id="a2" {...form.register('addressLine2')} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" {...form.register('city')} />
          </Field>
          <Field label="State / province" htmlFor="state">
            <Input id="state" {...form.register('state')} />
          </Field>
          <Field label="Postcode" htmlFor="pc">
            <Input id="pc" {...form.register('postcode')} />
          </Field>
        </div>
      </FormSection>
      <FormSection title="Regional" description={`Country ${org.country} · currency ${org.currency} · default timezone ${org.defaultTimezone}`}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date format (print)" htmlFor="df">
            <NativeSelect id="df" {...form.register('dateFormat')}>
              <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              <option value="yyyy-MM-dd">yyyy-MM-dd</option>
            </NativeSelect>
          </Field>
          <Field label="Weight unit" htmlFor="wu">
            <NativeSelect id="wu" {...form.register('weightUnit')}>
              <option value="kg">Kilograms</option>
              <option value="lb">Pounds</option>
            </NativeSelect>
          </Field>
          <Field label="Temperature unit" htmlFor="tu">
            <NativeSelect id="tu" {...form.register('temperatureUnit')}>
              <option value="C">°C</option>
              <option value="F">°F</option>
            </NativeSelect>
          </Field>
        </div>
      </FormSection>
      <div className="flex justify-end">
        <Button type="submit" loading={form.formState.isSubmitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export default function OrganizationSettings() {
  const q = useQuery({ queryKey: ['organization'], queryFn: () => api.get<Org>('/organization') });
  return (
    <RequirePermission anyOf={['org.manage']}>
      <Card>
        <CardContent className="pt-5">{q.isLoading ? <LoadingRows /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <OrgForm org={q.data!} />}</CardContent>
      </Card>
    </RequirePermission>
  );
}
