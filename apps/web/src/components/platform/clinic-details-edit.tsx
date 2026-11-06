'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClinicDetailsInput, ClinicDetailsView, ClinicOwnerInput } from '@vcms/shared';
import { Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { FormError } from '@/components/forms/form-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

/** The clinic's details and owner as the clinic has them now (from its own database). */
export function useClinicDetails(clinicId: string, enabled = true) {
  return useQuery({ queryKey: ['platform-clinic-details', clinicId], queryFn: () => api.get<ClinicDetailsView>(`/platform/clinics/${clinicId}/details`), enabled });
}

/** One line for the address, e.g. “12 Main Boulevard, Gulberg, Lahore 54000”. */
export function addressLine(c: ClinicDetailsView['clinic']) {
  return [c.addressLine1, c.addressLine2, c.city, [c.state, c.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
}

function useSave<T>(clinicId: string, path: 'details' | 'owner', done: string, onDone: () => void) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: T) => api.put<ClinicDetailsView>(`/platform/clinics/${clinicId}/${path}`, body),
    onSuccess: (d) => {
      qc.setQueryData(['platform-clinic-details', clinicId], d);
      qc.invalidateQueries({ queryKey: ['platform-clinic', clinicId] });
      qc.invalidateQueries({ queryKey: ['platform-clinics'] });
      toast.success(done);
      onDone();
    },
    onError: (e: Error) => {
      setErrors(e instanceof ApiError ? e.fieldErrors : {});
      setError(e.message);
    },
  });
  return { m, errors, error, reset: () => { setErrors({}); setError(null); } };
}

const CLINIC_FIELDS: { key: keyof ClinicDetailsInput; label: string; wide?: boolean; type?: string; hint?: string }[] = [
  { key: 'name', label: 'Clinic name', wide: true, hint: 'Shown to staff and on printouts unless the clinic set its own brand name.' },
  { key: 'legalName', label: 'Legal name' },
  { key: 'registrationNumber', label: 'Registration number' },
  { key: 'taxNumber', label: 'Tax number (NTN / ABN)' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'website', label: 'Website' },
  { key: 'addressLine1', label: 'Address', wide: true },
  { key: 'addressLine2', label: 'Address line 2', wide: true },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'Province / state' },
  { key: 'postcode', label: 'Postcode' },
];

export function ClinicDetailsDialog({ clinicId, details, onOpenChange }: { clinicId: string; details: ClinicDetailsView; onOpenChange: (o: boolean) => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(CLINIC_FIELDS.map((x) => [x.key, details.clinic[x.key] ?? ''])));
  const save = useSave<ClinicDetailsInput>(clinicId, 'details', 'Clinic details saved', () => onOpenChange(false));
  const fields = details.setUp ? CLINIC_FIELDS : CLINIC_FIELDS.filter((x) => x.key === 'name');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Edit clinic details</DialogTitle>
          <DialogDescription>
            {details.setUp
              ? 'The same details the clinic sees under Settings → Clinic details. The change is recorded in the clinic’s audit log. The country and web address can’t be changed.'
              : 'The clinic is not set up yet: only its name can be changed now.'}
          </DialogDescription>
        </DialogHeader>
        {save.error && <FormError message={save.error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((x) => (
            <Field key={x.key} label={x.label} htmlFor={`cd-${x.key}`} required={x.key === 'name'} hint={x.hint} error={save.errors[x.key]} className={x.wide ? 'sm:col-span-2' : undefined}>
              <Input id={`cd-${x.key}`} type={x.type} value={f[x.key]} onChange={(e) => setF((s) => ({ ...s, [x.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            loading={save.m.isPending}
            disabled={f.name.trim().length < 2}
            onClick={() => {
              save.reset();
              const body = Object.fromEntries(fields.map((x) => [x.key, x.key === 'name' ? f[x.key].trim() : f[x.key].trim() || null]));
              save.m.mutate(body as ClinicDetailsInput);
            }}
          >
            <Save /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OwnerDialog({ clinicId, details, onOpenChange }: { clinicId: string; details: ClinicDetailsView; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState(details.owner.name);
  const [email, setEmail] = useState(details.owner.email);
  const save = useSave<ClinicOwnerInput>(clinicId, 'owner', 'Owner details saved', () => onOpenChange(false));
  const emailChanged = email.trim().toLowerCase() !== details.owner.email.toLowerCase();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit owner</DialogTitle>
          <DialogDescription>The owner’s name and the email they sign in with. Their password stays the same.</DialogDescription>
        </DialogHeader>
        {save.error && <FormError message={save.error} />}
        <div className="grid gap-3">
          <Field label="Owner’s name" htmlFor="ow-name" required error={save.errors.name}>
            <Input id="ow-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Sign-in email" htmlFor="ow-email" required error={save.errors.email}>
            <Input id="ow-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {emailChanged && details.setUp && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
              From now on the owner signs in with <b>{email.trim().toLowerCase() || '…'}</b>. We email both the old and the new address to let them know.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            loading={save.m.isPending}
            disabled={name.trim().length < 2 || !email.trim()}
            onClick={() => {
              save.reset();
              save.m.mutate({ name: name.trim(), email: email.trim().toLowerCase() });
            }}
          >
            <Save /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
