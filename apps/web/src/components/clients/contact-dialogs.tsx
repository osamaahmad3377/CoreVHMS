'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { CONTACT_ROLES, addressSchema, clientContactSchema, enumLabel } from '@vcms/shared';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Field, applyServerErrors } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { ApiError, api } from '@/lib/api';
import type { Address, ClientContact } from '@/lib/types';

export function ContactDialog({
  clientId,
  contact,
  open,
  onOpenChange,
  onSaved,
}: {
  clientId: string;
  contact?: ClientContact | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof clientContactSchema>>({
    resolver: zodResolver(clientContactSchema),
    values: {
      role: (contact?.role as any) ?? 'EMERGENCY',
      name: contact?.name ?? '',
      relationship: contact?.relationship ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      canAuthorizeTreatment: contact?.canAuthorizeTreatment ?? false,
      canCollectAnimal: contact?.canCollectAnimal ?? false,
      notes: contact?.notes ?? '',
    },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (contact) await api.patch(`/clients/${clientId}/contacts/${contact.id}`, v);
      else await api.post(`/clients/${clientId}/contacts`, v);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) applyServerErrors(err.fieldErrors, form.setError);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  });
  const auth = useWatch({ control: form.control, name: 'canAuthorizeTreatment' });
  const collect = useWatch({ control: form.control, name: 'canCollectAnimal' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" htmlFor="c-role" error={e.role}>
              <NativeSelect id="c-role" {...form.register('role')}>
                {CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {enumLabel(r)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Relationship" htmlFor="c-rel" error={e.relationship}>
              <Input id="c-rel" placeholder="e.g. Spouse, Farm manager" {...form.register('relationship')} />
            </Field>
          </div>
          <Field label="Name" htmlFor="c-name" error={e.name} required>
            <Input id="c-name" {...form.register('name')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" htmlFor="c-phone" error={e.phone}>
              <Input id="c-phone" type="tel" {...form.register('phone')} />
            </Field>
            <Field label="Email" htmlFor="c-email" error={e.email}>
              <Input id="c-email" type="email" {...form.register('email')} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!auth} onCheckedChange={(v) => form.setValue('canAuthorizeTreatment', v === true)} />
              Can authorize treatment
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!collect} onCheckedChange={(v) => form.setValue('canCollectAnimal', v === true)} />
              Can collect animal
            </label>
          </div>
          <Field label="Notes" htmlFor="c-notes" error={e.notes}>
            <Textarea id="c-notes" rows={2} {...form.register('notes')} />
          </Field>
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

export function AddressDialog({
  clientId,
  address,
  country,
  open,
  onOpenChange,
  onSaved,
}: {
  clientId: string;
  address?: Address | null;
  country: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof addressSchema>>({
    resolver: zodResolver(addressSchema),
    values: {
      label: address?.label ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
      postcode: address?.postcode ?? '',
      country: address?.country ?? country,
      isPrimary: address?.isPrimary ?? false,
    },
  });
  const e = form.formState.errors;
  const primary = useWatch({ control: form.control, name: 'isPrimary' });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (address) await api.patch(`/clients/${clientId}/addresses/${address.id}`, v);
      else await api.post(`/clients/${clientId}/addresses`, v);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError) applyServerErrors(err.fieldErrors, form.setError);
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{address ? 'Edit address' : 'Add address'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <Field label="Label" htmlFor="a-label" hint="e.g. Home, Farm, Billing">
            <Input id="a-label" {...form.register('label')} />
          </Field>
          <Field label="Address line 1" htmlFor="a-l1" error={e.line1} required>
            <Input id="a-l1" {...form.register('line1')} />
          </Field>
          <Field label="Address line 2" htmlFor="a-l2">
            <Input id="a-l2" {...form.register('line2')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City / town" htmlFor="a-city">
              <Input id="a-city" {...form.register('city')} />
            </Field>
            <Field label="State / province" htmlFor="a-state">
              <Input id="a-state" {...form.register('state')} />
            </Field>
            <Field label="Postcode" htmlFor="a-pc">
              <Input id="a-pc" {...form.register('postcode')} />
            </Field>
            <Field label="Country" htmlFor="a-country">
              <NativeSelect id="a-country" {...form.register('country')}>
                <option value="PK">Pakistan</option>
                <option value="AU">Australia</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="a-primary" checked={!!primary} onCheckedChange={(v) => form.setValue('isPrimary', v === true)} />
            <Label htmlFor="a-primary">Primary address</Label>
          </div>
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
