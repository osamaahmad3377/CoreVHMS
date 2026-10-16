'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CLIENT_TYPES, CONTACT_CHANNELS, createClientSchema, enumLabel, updateClientSchema } from '@vcms/shared';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Field, FormSection, applyServerErrors, errorAt } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ClientDetail } from '@/lib/types';

type CreateValues = z.input<typeof createClientSchema>;

interface Props {
  client?: ClientDetail;
  onSaved: (client: { id: string }) => void;
  onCancel?: () => void;
}

const ORG_TYPES = ['FARM', 'BREEDER', 'COMPANY', 'SHELTER', 'OTHER'];

export function ClientForm({ client, onSaved, onCancel }: Props) {
  const editing = !!client;
  const { session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(editing ? (updateClientSchema as any) : createClientSchema),
    defaultValues: {
      type: (client?.type as any) ?? 'INDIVIDUAL',
      title: client?.title ?? '',
      firstName: client?.firstName ?? '',
      lastName: client?.lastName ?? '',
      organizationName: client?.organizationName ?? '',
      email: client?.email ?? '',
      mobilePhone: client?.mobilePhone ?? '',
      homePhone: client?.homePhone ?? '',
      workPhone: client?.workPhone ?? '',
      nationalId: client?.nationalId ?? '',
      taxNumber: client?.taxNumber ?? '',
      preferredChannel: (client?.preferredChannel as any) ?? (session.organization?.country === 'PK' ? 'WHATSAPP' : 'SMS'),
      preferredLanguage: client?.preferredLanguage ?? '',
      marketingConsent: client?.marketingConsent ?? false,
      remindersConsent: client?.remindersConsent ?? true,
      notes: client?.notes ?? '',
      referralSource: client?.referralSource ?? '',
      primaryBranchId: client?.primaryBranchId ?? session.branch?.id ?? '',
      address: editing ? undefined : { line1: '', line2: '', city: '', state: '', postcode: '', country: session.organization?.country ?? 'PK', isPrimary: true },
    },
  });
  const { register, formState, setError: setFieldError, control, setValue } = form;
  const e = formState.errors;
  const type = useWatch({ control, name: 'type' });
  const watched = useWatch({ control, name: ['firstName', 'lastName', 'organizationName', 'email', 'mobilePhone'] });
  const dupKey = useDebounce(JSON.stringify(watched), 500);
  const [wantAddress, setWantAddress] = useState(!editing);

  const dupes = useQuery({
    queryKey: ['client-dupes', dupKey, client?.id],
    queryFn: () => {
      const [firstName, lastName, organizationName, email, mobilePhone] = JSON.parse(dupKey) as (string | undefined)[];
      return api.post<{ id: string; displayName: string; clientNo: string; reasons: string[] }[]>('/clients/duplicates', {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        organizationName: organizationName || undefined,
        email: email || undefined,
        mobilePhone: mobilePhone || undefined,
        excludeId: client?.id,
      });
    },
    enabled: (() => {
      const [f, l, o, em, m] = JSON.parse(dupKey) as (string | undefined)[];
      return !!((l && l.length >= 2) || (o && o.length >= 3) || (em && em.includes('@')) || (m && m.replace(/\D/g, '').length >= 7) || (f && l));
    })(),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body: any = { ...values };
    if (!wantAddress || editing) delete body.address;
    if (!body.primaryBranchId) body.primaryBranchId = null;
    try {
      const saved = editing ? await api.patch<{ id: string }>(`/clients/${client!.id}`, body) : await api.post<{ id: string }>('/clients', body);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        applyServerErrors(err.fieldErrors, setFieldError);
        setError(err.message);
      } else setError('Could not save client');
    }
  });

  const isOrg = ORG_TYPES.includes(type ?? '');

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      {error && <FormError message={error} />}
      {!!dupes.data?.length && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> Possible existing client{dupes.data.length > 1 ? 's' : ''}
          </p>
          <ul className="mt-2 grid gap-1">
            {dupes.data.map((d) => (
              <li key={d.id}>
                <Link href={`/clients/${d.id}`} target="_blank" className="font-medium underline">
                  {d.displayName}
                </Link>{' '}
                <span className="text-muted-foreground">
                  ({d.clientNo}) — {d.reasons.join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Check before creating a new record to avoid duplicates. You can still continue.</p>
        </div>
      )}

      <FormSection title="Client" description="Individuals, families, farms and businesses are all clients.">
        <div className="grid gap-4 sm:grid-cols-[180px_100px_1fr_1fr]">
          <Field label="Client type" htmlFor="type" error={e.type}>
            <NativeSelect id="type" {...register('type')}>
              {CLIENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Title" htmlFor="title" error={e.title}>
            <NativeSelect id="title" {...register('title')}>
              <option value=""></option>
              {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Haji', 'Ch.'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={isOrg ? 'Contact first name' : 'First name'} htmlFor="firstName" error={e.firstName}>
            <Input id="firstName" autoComplete="given-name" {...register('firstName')} />
          </Field>
          <Field label={isOrg ? 'Contact surname' : 'Surname'} htmlFor="lastName" error={e.lastName} required={!isOrg}>
            <Input id="lastName" autoComplete="family-name" {...register('lastName')} />
          </Field>
        </div>
        {isOrg && (
          <Field label={type === 'FARM' ? 'Farm name' : 'Business / organization name'} htmlFor="organizationName" error={e.organizationName} required>
            <Input id="organizationName" {...register('organizationName')} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="National ID / CNIC" htmlFor="nationalId" error={e.nationalId}>
            <Input id="nationalId" {...register('nationalId')} />
          </Field>
          <Field label={session.organization?.country === 'AU' ? 'ABN' : 'NTN / tax number'} htmlFor="taxNumber" error={e.taxNumber}>
            <Input id="taxNumber" {...register('taxNumber')} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Contact details" description="At least one phone number or email is required.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile" htmlFor="mobilePhone" error={e.mobilePhone}>
            <Input id="mobilePhone" type="tel" autoComplete="tel" placeholder={session.organization?.country === 'AU' ? '04xx xxx xxx' : '03xx xxxxxxx'} {...register('mobilePhone')} />
          </Field>
          <Field label="Email" htmlFor="email" error={e.email}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Home phone" htmlFor="homePhone" error={e.homePhone}>
            <Input id="homePhone" type="tel" {...register('homePhone')} />
          </Field>
          <Field label="Work phone" htmlFor="workPhone" error={e.workPhone}>
            <Input id="workPhone" type="tel" {...register('workPhone')} />
          </Field>
          <Field label="Preferred channel" htmlFor="preferredChannel" error={e.preferredChannel}>
            <NativeSelect id="preferredChannel" {...register('preferredChannel')}>
              {CONTACT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {enumLabel(c)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Preferred language" htmlFor="preferredLanguage" error={e.preferredLanguage}>
            <NativeSelect id="preferredLanguage" {...register('preferredLanguage')}>
              <option value="">Default</option>
              <option value="en">English</option>
              <option value="ur">Urdu</option>
              <option value="pa">Punjabi</option>
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-2">
          <ConsentRow
            id="remindersConsent"
            checked={!!useWatch({ control, name: 'remindersConsent' })}
            onChange={(v) => setValue('remindersConsent', v, { shouldDirty: true })}
            label="Clinical reminders"
            hint="Vaccination, follow-up and appointment reminders."
          />
          <ConsentRow
            id="marketingConsent"
            checked={!!useWatch({ control, name: 'marketingConsent' })}
            onChange={(v) => setValue('marketingConsent', v, { shouldDirty: true })}
            label="Marketing messages"
            hint="Promotions and newsletters. Only with explicit consent."
          />
          {client?.consentUpdatedAt && <p className="text-xs text-muted-foreground">Consent last updated {new Date(client.consentUpdatedAt).toLocaleString()}</p>}
        </div>
      </FormSection>

      {!editing && (
        <FormSection title="Address" description="Primary address. More can be added later.">
          {!wantAddress ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setWantAddress(true)}>
              Add address
            </Button>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address line 1" htmlFor="a1" error={errorAt(e, 'address.line1')} required className="sm:col-span-2">
                <Input id="a1" autoComplete="address-line1" {...register('address.line1')} />
              </Field>
              <Field label="Address line 2" htmlFor="a2" className="sm:col-span-2">
                <Input id="a2" autoComplete="address-line2" {...register('address.line2')} />
              </Field>
              <Field label="City / town / village" htmlFor="city">
                <Input id="city" autoComplete="address-level2" {...register('address.city')} />
              </Field>
              <Field label={session.organization?.country === 'AU' ? 'State' : 'Province / district'} htmlFor="state">
                <Input id="state" {...register('address.state')} />
              </Field>
              <Field label="Postcode" htmlFor="postcode">
                <Input id="postcode" autoComplete="postal-code" {...register('address.postcode')} />
              </Field>
              <Field label="Country" htmlFor="country">
                <NativeSelect id="country" {...register('address.country')}>
                  <option value="PK">Pakistan</option>
                  <option value="AU">Australia</option>
                </NativeSelect>
              </Field>
              <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setWantAddress(false)}>
                Remove address
              </Button>
            </div>
          )}
        </FormSection>
      )}

      <FormSection title="Practice" description="Internal information.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Home branch" htmlFor="primaryBranchId">
            <NativeSelect id="primaryBranchId" {...register('primaryBranchId')}>
              <option value="">—</option>
              {session.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="How did they hear about us?" htmlFor="referralSource" error={e.referralSource}>
            <Input id="referralSource" {...register('referralSource')} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="notes" error={e.notes} hint="Visible to all staff with access to this client.">
          <Textarea id="notes" rows={3} {...register('notes')} />
        </Field>
      </FormSection>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={formState.isSubmitting}>
          {editing ? 'Save changes' : 'Create client'}
        </Button>
      </div>
    </form>
  );
}

function ConsentRow({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
