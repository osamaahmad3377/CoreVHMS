'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ALERT_SEVERITIES, ALERT_TYPES, IDENTIFIER_TYPES, alertSchema, enumLabel, identifierSchema, weightSchema } from '@vcms/shared';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ClientPicker, type PickedClient } from '../clients/client-picker';
import { Field, applyServerErrors } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { Label } from '../ui/label';
import { ApiError, api } from '@/lib/api';

interface Base {
  patientId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

function useServerForm<T extends z.ZodTypeAny>(schema: T, defaults: z.input<T>) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<T>>({ resolver: zodResolver(schema), defaultValues: defaults as any });
  const run = (fn: (v: z.input<T>) => Promise<unknown>, done: () => void) =>
    form.handleSubmit(async (v) => {
      setError(null);
      try {
        await fn(v);
        form.reset(defaults as any);
        done();
      } catch (err) {
        if (err instanceof ApiError) applyServerErrors(err.fieldErrors, form.setError as any);
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    });
  return { form, error, run };
}

export function WeightDialog({ patientId, open, onOpenChange, onSaved }: Base) {
  const { form, error, run } = useServerForm(weightSchema, {
    weightKg: '' as any,
    bodyConditionScore: '' as any,
    bcsScale: '9',
    measuredAt: new Date().toISOString().slice(0, 16) as any,
    notes: '',
  });
  const e = form.formState.errors;
  const submit = run(
    (v: any) =>
      api.post(`/patients/${patientId}/weights`, {
        ...v,
        bodyConditionScore: v.bodyConditionScore === '' ? null : v.bodyConditionScore,
        measuredAt: v.measuredAt ? new Date(v.measuredAt).toISOString() : undefined,
      }),
    () => {
      toast.success('Weight recorded');
      onSaved();
      onOpenChange(false);
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record weight</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <Field label="Weight (kg)" htmlFor="w-kg" error={e.weightKg as any} required>
            <Input id="w-kg" type="number" step="0.001" min="0" inputMode="decimal" autoFocus {...form.register('weightKg')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Body condition score" htmlFor="w-bcs" error={e.bodyConditionScore as any}>
              <Input id="w-bcs" type="number" min="1" max="9" {...form.register('bodyConditionScore')} />
            </Field>
            <Field label="BCS scale" htmlFor="w-scale">
              <NativeSelect id="w-scale" {...form.register('bcsScale')}>
                <option value="9">1–9</option>
                <option value="5">1–5</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Measured at" htmlFor="w-at">
            <Input id="w-at" type="datetime-local" {...form.register('measuredAt')} />
          </Field>
          <Field label="Notes" htmlFor="w-notes">
            <Input id="w-notes" {...form.register('notes')} />
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

export function AlertDialog({ patientId, open, onOpenChange, onSaved }: Base) {
  const { form, error, run } = useServerForm(alertSchema, {
    type: 'ALLERGY',
    severity: 'WARNING',
    title: '',
    details: '',
    substance: '',
    reaction: '',
    isActive: true,
  });
  const e = form.formState.errors;
  const type = useWatch({ control: form.control, name: 'type' });
  const submit = run(
    (v) => api.post(`/patients/${patientId}/alerts`, v),
    () => {
      toast.success('Alert added');
      onSaved();
      onOpenChange(false);
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add medical alert</DialogTitle>
          <DialogDescription>Alerts are shown on every clinical screen for this patient.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="al-type">
              <NativeSelect id="al-type" {...form.register('type')}>
                {ALERT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Severity" htmlFor="al-sev">
              <NativeSelect id="al-sev" {...form.register('severity')}>
                {ALERT_SEVERITIES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Title" htmlFor="al-title" error={e.title} required>
            <Input id="al-title" placeholder={type === 'ALLERGY' ? 'e.g. Penicillin allergy' : 'e.g. Aggressive when muzzled'} {...form.register('title')} />
          </Field>
          {(type === 'ALLERGY' || type === 'MEDICATION') && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Substance" htmlFor="al-sub" hint="Type the medicine or drug family, e.g. Amoxicillin or Penicillins.">
                <Input id="al-sub" {...form.register('substance')} />
              </Field>
              <Field label="Reaction" htmlFor="al-rx">
                <Input id="al-rx" {...form.register('reaction')} />
              </Field>
            </div>
          )}
          <Field label="Details" htmlFor="al-details">
            <Textarea id="al-details" rows={2} {...form.register('details')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add alert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IdentifierDialog({ patientId, open, onOpenChange, onSaved }: Base) {
  const { form, error, run } = useServerForm(identifierSchema, { type: 'MICROCHIP', value: '', issuedAt: '' as any, notes: '' });
  const e = form.formState.errors;
  const submit = run(
    (v) => api.post(`/patients/${patientId}/identifiers`, v),
    () => {
      toast.success('Microchip / tag added');
      onSaved();
      onOpenChange(false);
    },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add identifier</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          {error && <FormError message={error} />}
          <Field label="Type" htmlFor="id-type">
            <NativeSelect id="id-type" {...form.register('type')}>
              {IDENTIFIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {enumLabel(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Number / code" htmlFor="id-value" error={e.value} required>
            <Input id="id-value" autoFocus {...form.register('value')} />
          </Field>
          <Field label="Implanted / issued on" htmlFor="id-date">
            <Input id="id-date" type="date" {...form.register('issuedAt')} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeceasedDialog({ patientId, name, open, onOpenChange, onSaved }: Base & { name: string }) {
  const [deceasedAt, setAt] = useState(new Date().toISOString().slice(0, 16));
  const [cause, setCause] = useState('');
  const [euthanasia, setEuth] = useState(false);
  const [aftercare, setAftercare] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/deceased`, { deceasedAt: new Date(deceasedAt).toISOString(), causeOfDeath: cause, euthanasia, aftercare }),
    onSuccess: () => {
      toast.success('Recorded');
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record death of {name}</DialogTitle>
          <DialogDescription>The record becomes read-only for new bookings and reminders. This is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Date and time" htmlFor="d-at" required>
            <Input id="d-at" type="datetime-local" max={new Date().toISOString().slice(0, 16)} value={deceasedAt} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={euthanasia} onCheckedChange={(v) => setEuth(v === true)} /> Euthanasia
          </label>
          <Field label="Cause of death" htmlFor="d-cause">
            <Textarea id="d-cause" rows={2} value={cause} onChange={(e) => setCause(e.target.value)} />
          </Field>
          <Field label="Aftercare arrangements" htmlFor="d-after" hint="e.g. Individual cremation, home burial">
            <Input id="d-after" value={aftercare} onChange={(e) => setAftercare(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={m.isPending} onClick={() => m.mutate()}>
            Record death
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({ patientId, currentOwnerId, open, onOpenChange, onSaved }: Base & { currentOwnerId?: string }) {
  const [owner, setOwner] = useState<PickedClient | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/transfer`, { newOwnerId: owner!.id, reason }),
    onSuccess: () => {
      toast.success('Ownership transferred');
      setOwner(null);
      setReason('');
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>The current ownership period is closed and kept in the ownership history.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>New owner *</Label>
            <ClientPicker value={owner} onChange={setOwner} excludeId={currentOwnerId} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-reason">Reason *</Label>
            <Textarea id="t-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sold, rehomed, gifted" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!owner || !reason.trim()} loading={m.isPending} onClick={() => m.mutate()}>
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CoOwnerDialog({ patientId, excludeIds, open, onOpenChange, onSaved }: Base & { excludeIds: string[] }) {
  const [owner, setOwner] = useState<PickedClient | null>(null);
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/co-owners`, { clientId: owner!.id }),
    onSuccess: () => {
      toast.success('Co-owner added');
      setOwner(null);
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add co-owner</DialogTitle>
        </DialogHeader>
        <ClientPicker value={owner} onChange={setOwner} excludeId={excludeIds[0]} />
        {owner && excludeIds.includes(owner.id) && <p className="text-xs text-destructive">This client is already an owner.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!owner || excludeIds.includes(owner.id)} loading={m.isPending} onClick={() => m.mutate()}>
            Add co-owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
