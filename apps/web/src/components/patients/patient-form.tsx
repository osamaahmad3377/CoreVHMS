'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { IDENTIFIER_TYPES, PATIENT_SEXES, createPatientSchema, enumLabel, updatePatientSchema } from '@vcms/shared';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { Field, FormSection, applyServerErrors, errorAt } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Breed, PatientDetail, Species } from '@/lib/types';

type Values = z.input<typeof createPatientSchema>;

function dateInput(d?: string | null) {
  return d ? d.slice(0, 10) : '';
}

export function PatientForm({
  patient,
  initialOwner,
  onSaved,
  onCancel,
}: {
  patient?: PatientDetail;
  initialOwner?: PickedClient | null;
  onSaved: (p: { id: string }) => void;
  onCancel?: () => void;
}) {
  const editing = !!patient;
  const { session } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<PickedClient | null>(initialOwner ?? null);
  const [ageMode, setAgeMode] = useState<'dob' | 'age'>(patient?.dobEstimated ? 'age' : 'dob');
  const [ageYears, setAgeYears] = useState('');
  const [ageMonths, setAgeMonths] = useState('');

  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), staleTime: 300_000 });
  const form = useForm<Values>({
    resolver: zodResolver(editing ? (updatePatientSchema as any) : createPatientSchema),
    defaultValues: {
      ownerId: initialOwner?.id ?? '',
      name: patient?.name ?? '',
      speciesId: patient?.species.id ?? '',
      breedId: patient?.breed?.id ?? '',
      breedText: patient?.breedText ?? '',
      sex: (patient?.sex as any) ?? 'UNKNOWN',
      colour: patient?.colour ?? '',
      markings: patient?.markings ?? '',
      dateOfBirth: dateInput(patient?.dateOfBirth) as any,
      dobEstimated: patient?.dobEstimated ?? false,
      bloodType: patient?.bloodType ?? '',
      insuranceProvider: patient?.insuranceProvider ?? '',
      insurancePolicyNumber: patient?.insurancePolicyNumber ?? '',
      notes: patient?.notes ?? '',
      primaryBranchId: patient?.primaryBranchId ?? session.branch?.id ?? '',
      identifiers: [],
      initialWeightKg: '' as any,
    },
  });
  const { register, control, formState, setValue } = form;
  const e = formState.errors;
  const ids = useFieldArray({ control, name: 'identifiers' });
  const speciesId = useWatch({ control, name: 'speciesId' });
  const name = useWatch({ control, name: 'name' });
  const identifierValues = useWatch({ control, name: 'identifiers' });

  const breeds = useQuery({
    queryKey: ['breeds', speciesId],
    queryFn: () => api.get<Breed[]>(`/species/${speciesId}/breeds`),
    enabled: !!speciesId,
    staleTime: 300_000,
  });

  const dupKey = useDebounce(
    JSON.stringify({ name, ownerId: owner?.id, speciesId, identifiers: (identifierValues ?? []).map((i) => i.value).filter((v) => v && v.length >= 3) }),
    500,
  );
  const dupes = useQuery({
    queryKey: ['patient-dupes', dupKey, patient?.id],
    queryFn: () => api.post<{ id: string; name: string; patientNo: string; reasons: string[] }[]>('/patients/duplicates', { ...JSON.parse(dupKey), excludeId: patient?.id }),
    enabled: (() => {
      const v = JSON.parse(dupKey);
      return !!(v.name && v.ownerId) || v.identifiers.length > 0;
    })(),
  });

  const grouped = (species.data ?? []).reduce<Record<string, Species[]>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body: any = { ...values };
    if (!editing) {
      if (!owner) {
        form.setError('ownerId', { message: 'Select the owner' });
        return;
      }
      body.ownerId = owner.id;
      if (body.initialWeightKg === '' || body.initialWeightKg === undefined) body.initialWeightKg = null;
    } else {
      delete body.ownerId;
      delete body.identifiers;
      delete body.initialWeightKg;
    }
    if (ageMode === 'age') {
      const y = Number(ageYears || 0);
      const m = Number(ageMonths || 0);
      if (y || m) {
        const d = new Date();
        d.setMonth(d.getMonth() - (y * 12 + m));
        body.dateOfBirth = d.toISOString().slice(0, 10);
        body.dobEstimated = true;
      } else {
        body.dobEstimated = !!body.dateOfBirth;
      }
    } else {
      body.dobEstimated = false;
    }
    for (const k of ['breedId', 'primaryBranchId']) if (!body[k]) body[k] = null;
    if (!body.dateOfBirth) body.dateOfBirth = null;
    try {
      const saved = editing ? await api.patch<{ id: string }>(`/patients/${patient!.id}`, body) : await api.post<{ id: string }>('/patients', body);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        applyServerErrors(err.fieldErrors, form.setError);
        setError(err.message);
      } else setError('Could not save patient');
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      {error && <FormError message={error} />}
      {!!dupes.data?.length && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> Possible duplicate registration
          </p>
          <ul className="mt-1 grid gap-1">
            {dupes.data.map((d) => (
              <li key={d.id}>
                <Link href={`/patients/${d.id}`} target="_blank" className="font-medium underline">
                  {d.name} ({d.patientNo})
                </Link>{' '}
                <span className="text-muted-foreground">— {d.reasons.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!editing && (
        <FormSection title="Owner" description="Legal owner responsible for the animal. Co-owners can be added afterwards.">
          <Field label="Owner" htmlFor="owner" error={e.ownerId} required>
            <ClientPicker id="owner" value={owner} onChange={(c) => { setOwner(c); if (c) form.clearErrors('ownerId'); }} invalid={!!e.ownerId} />
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            Owner not registered yet?{' '}
            <Link href="/clients/new" className="text-primary hover:underline">
              Create the client first
            </Link>
            .
          </p>
        </FormSection>
      )}

      <FormSection title="Animal" description="Identity and signalment.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" error={e.name} required>
            <Input id="name" {...register('name')} />
          </Field>
          <Field label="Species" htmlFor="speciesId" error={e.speciesId} required>
            <NativeSelect
              id="speciesId"
              {...register('speciesId', { onChange: () => setValue('breedId', '') })}
            >
              <option value="">Select species…</option>
              {Object.entries(grouped).map(([cat, list]) => (
                <optgroup key={cat} label={enumLabel(cat)}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Breed" htmlFor="breedId" error={e.breedId}>
            <NativeSelect id="breedId" disabled={!speciesId} {...register('breedId')}>
              <option value="">{breeds.data?.length ? 'Select breed…' : 'No breeds listed'}</option>
              {breeds.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Breed (other / cross details)" htmlFor="breedText" error={e.breedText}>
            <Input id="breedText" placeholder="e.g. Labrador × Pointer" {...register('breedText')} />
          </Field>
          <Field label="Sex" htmlFor="sex" error={e.sex}>
            <NativeSelect id="sex" {...register('sex')}>
              {PATIENT_SEXES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={ageMode === 'dob' ? 'dob' : 'ageY'}>{ageMode === 'dob' ? 'Date of birth' : 'Estimated age'}</Label>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAgeMode(ageMode === 'dob' ? 'age' : 'dob')}>
                {ageMode === 'dob' ? 'Enter estimated age instead' : 'Enter exact date instead'}
              </button>
            </div>
            {ageMode === 'dob' ? (
              <Input id="dob" type="date" max={new Date().toISOString().slice(0, 10)} {...register('dateOfBirth')} />
            ) : (
              <div className="flex gap-2">
                <Input id="ageY" type="number" min={0} max={60} placeholder="Years" value={ageYears} onChange={(ev) => setAgeYears(ev.target.value)} />
                <Input type="number" min={0} max={11} placeholder="Months" aria-label="Months" value={ageMonths} onChange={(ev) => setAgeMonths(ev.target.value)} />
              </div>
            )}
          </div>
          <Field label="Colour" htmlFor="colour" error={e.colour}>
            <Input id="colour" {...register('colour')} />
          </Field>
          <Field label="Blood type" htmlFor="bloodType" error={e.bloodType}>
            <Input id="bloodType" placeholder="e.g. DEA 1.1+ / A" {...register('bloodType')} />
          </Field>
        </div>
        <Field label="Markings / distinguishing features" htmlFor="markings" error={e.markings}>
          <Input id="markings" {...register('markings')} />
        </Field>
      </FormSection>

      {!editing && (
        <FormSection title="Identification" description="Microchip, ear tag, RFID or tattoo. Each identifier can belong to only one animal.">
          {ids.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[150px_1fr_auto] items-start gap-2">
              <NativeSelect aria-label="Identifier type" {...register(`identifiers.${i}.type` as const)}>
                {IDENTIFIER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </NativeSelect>
              <div>
                <Input aria-label="Identifier value" {...register(`identifiers.${i}.value` as const)} aria-invalid={!!errorAt(e, `identifiers.${i}.value`) || undefined} />
                {errorAt(e, `identifiers.${i}.value`) && <p className="mt-1 text-xs text-destructive">{errorAt(e, `identifiers.${i}.value`)?.message}</p>}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => ids.remove(i)} aria-label="Remove identifier">
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => ids.append({ type: 'MICROCHIP', value: '' })}>
            <Plus /> Add identifier
          </Button>
          <Field label="Current weight (kg)" htmlFor="weight" error={e.initialWeightKg} className="max-w-[200px]">
            <Input id="weight" type="number" step="0.001" min="0" inputMode="decimal" {...register('initialWeightKg')} />
          </Field>
        </FormSection>
      )}

      <FormSection title="Other" description="Insurance and internal notes.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Insurance provider" htmlFor="insuranceProvider">
            <Input id="insuranceProvider" {...register('insuranceProvider')} />
          </Field>
          <Field label="Policy number" htmlFor="insurancePolicyNumber">
            <Input id="insurancePolicyNumber" {...register('insurancePolicyNumber')} />
          </Field>
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
        </div>
        <Field label="Notes" htmlFor="notes" hint="Non-clinical notes (diet, temperament, preferences). Clinical findings belong in consultations.">
          <Textarea id="notes" rows={3} {...register('notes')} />
        </Field>
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={ageMode === 'age'} onCheckedChange={(v) => setAgeMode(v === true ? 'age' : 'dob')} />
            Date of birth is an estimate
          </label>
        )}
      </FormSection>

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={formState.isSubmitting}>
          {editing ? 'Save changes' : 'Register patient'}
        </Button>
      </div>
    </form>
  );
}
