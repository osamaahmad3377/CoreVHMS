'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CLIENT_TYPES, CONTACT_CHANNELS, PATIENT_SEXES, createClientSchema, enumLabel, updateClientSchema } from '@vcms/shared';
import { AlertTriangle, Building2, CheckCircle2, ChevronDown, ExternalLink, Heart, Home, Mail, MapPin, MessageCircle, MessageSquare, PawPrint, Phone, Plus, Tractor, Trash2, User, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Field, FormSection, applyServerErrors, errorAt } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/use-debounce';
import { useDiscardConfirm } from '@/hooks/use-discard-confirm';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Paginated } from '@vcms/shared';
import type { ClientDetail, PatientRow, Species } from '@/lib/types';
import { Avatar } from '@/components/ui/misc';
import { fmtAge } from '@/lib/format';
import { cn } from '@/lib/utils';

type CreateValues = z.input<typeof createClientSchema>;

interface Props {
  client?: ClientDetail;
  onSaved: (client: { id: string; displayName?: string; clientNo?: string }) => void;
  onCancel?: () => void;
}

const ORG_TYPES = ['FARM', 'BREEDER', 'COMPANY', 'SHELTER', 'OTHER'];
/** "Bilal Hussain" → first name "Bilal", surname "Hussain"; "Muhammad Bilal Hussain" → "Muhammad Bilal" + "Hussain"; one word stays a first name. */
function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.length < 2 ? { firstName: parts[0] ?? '', lastName: '' } : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
/** Fields under "More details (optional)"; the section opens by itself when one of them has an error. */
const MORE_FIELDS = ['nationalId', 'taxNumber', 'homePhone', 'workPhone', 'preferredLanguage', 'notes', 'referralSource', 'primaryBranchId'] as const;
const TYPE_ICON: Record<string, LucideIcon> = { INDIVIDUAL: User, FARM: Tractor, BREEDER: PawPrint, COMPANY: Building2, SHELTER: Heart, OTHER: Home };
const CHANNEL_ICON: Record<string, LucideIcon> = { WHATSAPP: MessageCircle, SMS: MessageSquare, EMAIL: Mail, PHONE: Phone };

type Match = { id: string; displayName: string; clientNo: string; reasons: string[] };

/** A client already registered with this mobile number: who they are, their animals, and what to do next. */
function RegisteredOwner({ d }: { d: Match }) {
  const { can } = useSession();
  const pets = useQuery({ queryKey: ['patients', 'owner', d.id], queryFn: () => api.get<Paginated<PatientRow>>(`/patients?ownerId=${d.id}&status=ACTIVE&pageSize=20`) });
  const first = d.displayName.split(/\s+/)[0];
  const rows = pets.data?.data ?? [];
  return (
    <div className="grid gap-3 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={d.displayName} className="h-10 w-10 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{d.displayName}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{d.clientNo}</span>
            {d.reasons.map((r) => (
              <span key={r} className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                {r}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Their animals{rows.length ? ` · ${rows.length}` : ''}</p>
        {pets.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length ? (
          <ul className="grid gap-1.5 sm:grid-cols-2" aria-label={`Animals of ${d.displayName}`}>
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/patients/${p.id}`} target="_blank" className="flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <PawPrint className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[p.species.name, p.breed, p.dateOfBirth ? fmtAge(p.dateOfBirth, p.dobEstimated) : null, p.patientNo].filter(Boolean).join(' · ')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No animals registered yet.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {can('patients.write') && (
          <Button size="sm" asChild>
            <Link href={`/patients/new?ownerId=${d.id}`}>
              <Plus /> Add a pet for {first}
            </Link>
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link href={`/clients/${d.id}`}>
            <ExternalLink className="h-3.5 w-3.5" /> Open client record
          </Link>
        </Button>
      </div>
    </div>
  );
}

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
      // The address is optional and starts collapsed, so a quick name + phone registration validates.
      address: undefined,
    },
  });
  const blankAddress = { line1: '', line2: '', city: '', state: '', postcode: '', country: session.organization?.country ?? 'PK', isPrimary: true };
  const { register, formState, setError: setFieldError, control, setValue } = form;
  const e = formState.errors;
  const type = useWatch({ control, name: 'type' });
  const watched = useWatch({ control, name: ['firstName', 'lastName', 'organizationName', 'email', 'mobilePhone'] });
  const dupKey = useDebounce(JSON.stringify(watched), 500);
  const [wantAddress, setWantAddress] = useState(false);
  // One "Full name" box; it is kept as first name and surname (for records, search and duplicate checks).
  const [fullName, setFullName] = useState(() => [client?.firstName, client?.lastName].filter(Boolean).join(' '));
  const changeName = (v: string) => {
    setFullName(v);
    const n = splitName(v);
    setValue('firstName', n.firstName, { shouldDirty: true, shouldValidate: formState.isSubmitted });
    setValue('lastName', n.lastName, { shouldDirty: true, shouldValidate: formState.isSubmitted });
  };
  // Their first animal, registered with them (new clients only).
  const [wantPet, setWantPet] = useState(false);
  const [pet, setPet] = useState({ name: '', speciesId: '', sex: 'UNKNOWN', dateOfBirth: '', breedText: '' });
  const [petErrors, setPetErrors] = useState<{ name?: string; speciesId?: string }>({});
  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), staleTime: 300_000, enabled: !editing });
  const speciesGroups = (species.data ?? []).reduce<Record<string, Species[]>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});
  const channel = useWatch({ control, name: 'preferredChannel' });
  const remindersOn = !!useWatch({ control, name: 'remindersConsent' });
  const marketingOn = !!useWatch({ control, name: 'marketingConsent' });
  // Mobile first: an owner already registered with this number is shown with their animals, instead of a new record.
  const mobile = useWatch({ control, name: 'mobilePhone' }) ?? '';
  const mobileDigits = useDebounce(mobile.replace(/\D/g, ''), 400);
  const phoneReady = !editing && mobileDigits.length >= 10;
  const byPhone = useQuery({
    queryKey: ['client-dupes', 'mobile', mobileDigits],
    queryFn: () => api.post<Match[]>('/clients/duplicates', { mobilePhone: mobileDigits }),
    enabled: phoneReady,
  });
  const sameNumber = phoneReady ? (byPhone.data ?? []).filter((d) => d.reasons.includes('Same mobile number')) : [];
  const [anyway, setAnyway] = useState<string | null>(null);
  const blocked = !editing && sameNumber.length > 0 && anyway !== mobileDigits;
  const discard = useDiscardConfirm();
  const [moreOpen, setMoreOpen] = useState(() => !!client && MORE_FIELDS.some((k) => k !== 'primaryBranchId' && !!client[k as keyof ClientDetail]));
  const moreHasError = MORE_FIELDS.some((k) => !!e[k]);
  const showMore = moreOpen || moreHasError;
  const cancel = async () => {
    if (onCancel && (await discard(formState.isDirty || wantAddress))) onCancel();
  };
  const formRef = useRef<HTMLFormElement>(null);
  /** Brings the first invalid field into view (errors may be far down a long form, or come back from the server). */
  const revealFirstError = () =>
    requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    });
  const toggleAddress = (on: boolean) => {
    setWantAddress(on);
    if (on) setValue('address', blankAddress);
    else {
      form.unregister('address');
      form.clearErrors('address');
    }
  };

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

  const onSubmit = form.handleSubmit(
    async (values) => {
      setError(null);
      if (wantPet && !editing) {
        const pe = { name: pet.name.trim() ? undefined : 'Enter the animal’s name', speciesId: pet.speciesId ? undefined : 'Choose the species' };
        setPetErrors(pe);
        if (pe.name || pe.speciesId) return revealFirstError();
      }
      const body: any = { ...values };
      if (!wantAddress || editing) delete body.address;
      if (!body.primaryBranchId) body.primaryBranchId = null;
      try {
        const saved = editing ? await api.patch<{ id: string; displayName: string }>(`/clients/${client!.id}`, body) : await api.post<{ id: string; displayName: string; clientNo: string }>('/clients', body);
        // Their first animal: a problem here leaves the client saved (the animal can be added from their record).
        if (wantPet && !editing) {
          try {
            await api.post('/patients', { ownerId: saved.id, name: pet.name.trim(), speciesId: pet.speciesId, sex: pet.sex, dateOfBirth: pet.dateOfBirth || undefined, dobEstimated: false, breedText: pet.breedText.trim() || undefined, identifiers: [], primaryBranchId: session.branch?.id ?? null });
          } catch (pe) {
            setError(`Client saved, but the animal was not: ${(pe as Error).message}. Add it from the client’s record.`);
          }
        }
        onSaved(saved);
      } catch (err) {
        if (err instanceof ApiError) {
          applyServerErrors(err.fieldErrors, setFieldError);
          setError(err.message);
          revealFirstError();
        } else setError('Could not save client');
      }
    },
    revealFirstError,
  );

  const isOrg = ORG_TYPES.includes(type ?? '');
  // Title and full name: first on a new client (with the mobile number), in "Who is the client?" when editing.
  const nameFields = (
        <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
      <Field label="Title" htmlFor="title" error={e.title}>
        <NativeSelect id="title" {...register('title')}>
          <option value=""></option>
          {['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Haji', 'Ch.'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={isOrg ? 'Contact person (full name)' : 'Full name'} htmlFor="fullName" error={e.firstName ?? e.lastName} required={!isOrg}>
        <Input id="fullName" autoFocus={!editing} autoComplete="name" placeholder="e.g. Muhammad Bilal Hussain" value={fullName} aria-invalid={!!(e.firstName ?? e.lastName)} onChange={(ev) => changeName(ev.target.value)} />
      </Field>
    </div>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-6" noValidate>
      {error && <FormError message={error} />}
      {!blocked && !!dupes.data?.filter((d) => !sameNumber.some((x) => x.id === d.id) || anyway === mobileDigits).length && (
        <div className="rounded-xl border border-warning/40 bg-warning/[0.07] p-4 text-sm" role="status">
          <p className="flex items-center gap-2 font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" /> Possible existing client{dupes.data.length > 1 ? 's' : ''}
          </p>
          <ul className="mt-3 grid gap-2">
            {dupes.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2">
                <span className="font-medium">{d.displayName}</span>
                <span className="font-mono text-xs text-muted-foreground">{d.clientNo}</span>
                <span className="flex flex-wrap gap-1">
                  {d.reasons.map((r) => (
                    <span key={r} className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                      {r}
                    </span>
                  ))}
                </span>
                <Button size="sm" variant="outline" className="ml-auto h-7" asChild>
                  <Link href={`/clients/${d.id}`} target="_blank">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Check before adding a new record, so the same person is not registered twice. You can still continue.</p>
        </div>
      )}

      {!editing && (
        <FormSection title="Owner" description="Their full name and mobile number. We check whether they are already registered.">
          {nameFields}
          <Field label="Mobile" htmlFor="mobilePhone" error={e.mobilePhone} hint="Also used for WhatsApp, if they have it.">
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="mobilePhone" type="tel" autoComplete="tel" className="pl-9" placeholder={session.organization?.country === 'AU' ? '0412 345 678' : '0300 1234567'} {...register('mobilePhone')} />
            </div>
          </Field>
          {phoneReady && byPhone.isFetching && !byPhone.data ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : blocked ? (
            <div className="grid gap-3 rounded-xl border border-warning/40 bg-warning/[0.07] p-4" role="status">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <AlertTriangle className="h-4 w-4" /> Possible existing client — this mobile number is already registered
              </p>
              {sameNumber.map((d) => (
                <RegisteredOwner key={d.id} d={d} />
              ))}
              <button type="button" className="w-fit text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setAnyway(mobileDigits)}>
                A different person with the same number (e.g. a family member)? Register a new client anyway
              </button>
            </div>
          ) : phoneReady && !sameNumber.length && byPhone.isSuccess ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> New number — not registered yet. Continue with their details below.
            </p>
          ) : anyway === mobileDigits && sameNumber.length ? (
            <p className="text-xs text-muted-foreground">Registering another client with the same number.</p>
          ) : null}
        </FormSection>
      )}

      {!blocked && (
      <>
      <FormSection title={editing ? 'Who is the client?' : 'Type of client'} description="A pet owner, family, farm or business.">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Client type</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Client type">
            {CLIENT_TYPES.map((t) => {
              const Icon = TYPE_ICON[t] ?? User;
              const on = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setValue('type', t as never, { shouldDirty: true, shouldValidate: formState.isSubmitted })}
                  className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground')}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {enumLabel(t)}
                </button>
              );
            })}
          </div>
        </div>
        {editing && nameFields}
        {isOrg && (
          <Field label={type === 'FARM' ? 'Farm name' : 'Business name'} htmlFor="organizationName" error={e.organizationName} required>
            <Input id="organizationName" {...register('organizationName')} />
          </Field>
        )}
      </FormSection>

      <FormSection title={editing ? 'How to reach them' : 'Email and messages'} description={editing ? 'A mobile number (or an email) is needed. Confirmations and reminders go here.' : 'How they would like to hear from you.'}>
        <div className="grid gap-4 sm:grid-cols-2">
          {editing && (
            <Field label="Mobile" htmlFor="mobilePhone" error={e.mobilePhone} hint="Also used for WhatsApp, if they have it.">
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="mobilePhone" type="tel" autoComplete="tel" className="pl-9" placeholder={session.organization?.country === 'AU' ? '0412 345 678' : '0300 1234567'} {...register('mobilePhone')} />
              </div>
            </Field>
          )}
          <Field label="Email (optional)" htmlFor="email" error={e.email}>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="email" type="email" autoComplete="email" className="pl-9" placeholder="name@gmail.com" {...register('email')} />
            </div>
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Send messages by</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preferred channel">
            {CONTACT_CHANNELS.map((c) => {
              const Icon = CHANNEL_ICON[c] ?? MessageSquare;
              const on = channel === c;
              return (
                <button key={c} type="button" role="radio" aria-checked={on} onClick={() => setValue('preferredChannel', c as never, { shouldDirty: true })} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors', on ? 'border-primary bg-primary/10 text-primary' : 'bg-background text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {enumLabel(c)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ConsentRow
            id="remindersConsent"
            checked={remindersOn}
            onChange={(v) => setValue('remindersConsent', v, { shouldDirty: true })}
            label="Clinical reminders"
            hint="Vaccination, follow-up and appointment reminders."
          />
          <ConsentRow
            id="marketingConsent"
            checked={marketingOn}
            onChange={(v) => setValue('marketingConsent', v, { shouldDirty: true })}
            label="Marketing messages"
            hint="Offers and news. Only with their clear agreement."
          />
          {client?.consentUpdatedAt && <p className="text-xs text-muted-foreground sm:col-span-2">Consent last updated {new Date(client.consentUpdatedAt).toLocaleString()}</p>}
        </div>
      </FormSection>

      {!editing && (
        <FormSection title="Address" description="Optional. Add the primary address now or later from the client record.">
          {!wantAddress ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => toggleAddress(true)}>
              <MapPin /> Add address
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
              <Button type="button" variant="outline" size="sm" className="w-fit text-destructive hover:text-destructive sm:col-span-2" onClick={() => toggleAddress(false)}>
                <Trash2 /> Remove address
              </Button>
            </div>
          )}
        </FormSection>
      )}

      {!editing && (
        <FormSection title="Their first animal" description="Optional. Register the pet with the owner in one go.">
          {!wantPet ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setWantPet(true)}>
              <Plus /> Add their animal now
            </Button>
          ) : (
            <div className="grid gap-4 rounded-xl border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Animal’s name" htmlFor="pet-name" required error={petErrors.name}>
                  <Input id="pet-name" value={pet.name} aria-invalid={!!petErrors.name} onChange={(ev) => setPet({ ...pet, name: ev.target.value })} />
                </Field>
                <Field label="Species" htmlFor="pet-species" required error={petErrors.speciesId}>
                  <NativeSelect id="pet-species" value={pet.speciesId} aria-invalid={!!petErrors.speciesId} onChange={(ev) => setPet({ ...pet, speciesId: ev.target.value })}>
                    <option value="">Choose…</option>
                    {Object.entries(speciesGroups).map(([cat, list]) => (
                      <optgroup key={cat} label={enumLabel(cat)}>
                        {list.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Sex" htmlFor="pet-sex">
                  <NativeSelect id="pet-sex" value={pet.sex} onChange={(ev) => setPet({ ...pet, sex: ev.target.value })}>
                    {PATIENT_SEXES.map((x) => (
                      <option key={x} value={x}>
                        {x === 'UNKNOWN' ? 'Not known' : enumLabel(x)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Date of birth (optional)" htmlFor="pet-dob">
                  <Input id="pet-dob" type="date" max={new Date().toISOString().slice(0, 10)} value={pet.dateOfBirth} onChange={(ev) => setPet({ ...pet, dateOfBirth: ev.target.value })} />
                </Field>
                <Field label="Breed (optional)" htmlFor="pet-breed" className="sm:col-span-2">
                  <Input id="pet-breed" placeholder="e.g. Persian" value={pet.breedText} onChange={(ev) => setPet({ ...pet, breedText: ev.target.value })} />
                </Field>
              </div>
              <Button type="button" variant="outline" size="sm" className="w-fit text-destructive hover:text-destructive" onClick={() => { setWantPet(false); setPetErrors({}); }}>
                <Trash2 /> Don’t add an animal now
              </Button>
            </div>
          )}
        </FormSection>
      )}

      <button
        type="button"
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={showMore}
        aria-controls="client-more"
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} /> More details (optional)
      </button>

      <div id="client-more" className={showMore ? 'grid gap-6' : 'hidden'}>
      <FormSection title="Identity and other phones" description="CNIC, tax number and extra phone numbers.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="National ID / CNIC" htmlFor="nationalId" error={e.nationalId}>
            <Input id="nationalId" {...register('nationalId')} />
          </Field>
          <Field label={session.organization?.country === 'AU' ? 'ABN' : 'NTN / tax number'} htmlFor="taxNumber" error={e.taxNumber}>
            <Input id="taxNumber" {...register('taxNumber')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Home phone" htmlFor="homePhone" error={e.homePhone}>
            <Input id="homePhone" type="tel" {...register('homePhone')} />
          </Field>
          <Field label="Work phone" htmlFor="workPhone" error={e.workPhone}>
            <Input id="workPhone" type="tel" {...register('workPhone')} />
          </Field>
        </div>
      </FormSection>

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
          <Field label="Preferred language" htmlFor="preferredLanguage" error={e.preferredLanguage}>
            <NativeSelect id="preferredLanguage" {...register('preferredLanguage')}>
              <option value="">Default</option>
              <option value="en">English</option>
              <option value="ur">Urdu</option>
              <option value="pa">Punjabi</option>
            </NativeSelect>
          </Field>
        </div>
        <Field label="Notes" htmlFor="notes" error={e.notes} hint="Visible to all staff with access to this client.">
          <Textarea id="notes" rows={3} {...register('notes')} />
        </Field>
      </FormSection>
      </div>

      </>
      )}

      <div className="action-bar -mx-6 flex justify-end gap-2 rounded-b-xl px-6 py-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
        {!blocked && (
          <Button type="submit" loading={formState.isSubmitting}>
            {editing ? 'Save' : 'Add client'}
          </Button>
        )}
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
