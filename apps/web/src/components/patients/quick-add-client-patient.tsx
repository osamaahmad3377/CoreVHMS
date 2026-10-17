'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PATIENT_SEXES, createClientSchema, enumLabel } from '@vcms/shared';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { Button } from '../ui/button';
import { Input, NativeSelect } from '../ui/input';
import { useDebounce } from '@/hooks/use-debounce';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Species } from '@/lib/types';
import type { PickedPatient } from './patient-picker';

interface SavedClient {
  id: string;
  displayName: string;
  mobilePhone: string | null;
  clientNo?: string;
}

/** "Bilal Hussain" → first name "Bilal", surname "Hussain"; a single name stays a first name. */
function splitName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

const looksLikePhone = (s: string) => /^[+\d\s()-]+$/.test(s) && s.replace(/\D/g, '').length >= 4;

/**
 * Registers a brand-new client and their first patient in one short form, without leaving the dialog the
 * front desk is working in (walk-in, booking). Uses the normal client and patient APIs, so the same
 * validation, numbering and audit trail apply.
 */
export function QuickAddClientPatient({
  seed,
  onCreated,
  onCancel,
}: {
  /** What the user searched for: a phone number fills Mobile, anything else fills the client's name. */
  seed: string;
  onCreated: (p: PickedPatient) => void;
  onCancel: () => void;
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [clientName, setClientName] = useState(looksLikePhone(seed) ? '' : seed);
  const [mobile, setMobile] = useState(looksLikePhone(seed) ? seed : '');
  const [patientName, setPatientName] = useState('');
  const [speciesId, setSpeciesId] = useState('');
  const [sex, setSex] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Kept after a successful client save, so fixing a patient error and saving again does not create the client twice.
  const [client, setClient] = useState<SavedClient | null>(null);

  const species = useQuery({ queryKey: ['species'], queryFn: () => api.get<Species[]>('/species'), staleTime: 300_000 });
  const grouped = (species.data ?? []).reduce<Record<string, Species[]>>((acc, s) => ((acc[s.category] ??= []).push(s), acc), {});

  const phoneKey = useDebounce(mobile.replace(/\D/g, ''), 400);
  const existing = useQuery({
    queryKey: ['client-dupes', 'quick-add', phoneKey],
    queryFn: () => api.post<{ id: string; displayName: string; clientNo: string; reasons: string[] }[]>('/clients/duplicates', { mobilePhone: phoneKey }),
    enabled: !client && phoneKey.length >= 10,
  });

  const save = async () => {
    setFormError(null);
    const next: Record<string, string> = {};
    const name = splitName(clientName);
    const clientBody = {
      type: 'INDIVIDUAL' as const,
      ...name,
      mobilePhone: mobile.trim(),
      preferredChannel: session.organization?.country === 'PK' ? ('WHATSAPP' as const) : ('SMS' as const),
      primaryBranchId: session.branch?.id ?? null,
    };
    if (!client) {
      if (!clientName.trim()) next.clientName = 'Enter the client’s name';
      if (!mobile.trim()) next.mobile = 'Enter the client’s mobile number';
      const parsed = createClientSchema.safeParse(clientBody);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.path[0] === 'mobilePhone' && !next.mobile) next.mobile = issue.message;
          if ((issue.path[0] === 'firstName' || issue.path[0] === 'lastName') && !next.clientName) next.clientName = issue.message;
        }
      }
    }
    if (!patientName.trim()) next.patientName = 'Enter the patient’s name';
    if (!speciesId) next.speciesId = 'Choose the species';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    let saved = client;
    try {
      if (!saved) {
        saved = await api.post<SavedClient>('/clients', clientBody);
        setClient(saved);
      }
      const p = await api.post<{ id: string; name: string; patientNo: string }>('/patients', {
        ownerId: saved.id,
        name: patientName.trim(),
        speciesId,
        sex: sex || 'UNKNOWN',
        primaryBranchId: session.branch?.id ?? null,
      });
      const sp = species.data?.find((s) => s.id === speciesId);
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient-picker'] });
      toast.success(`Client and patient added: ${p.name} (${p.patientNo}) for ${saved.displayName}${saved.clientNo ? ` (${saved.clientNo})` : ''}`);
      onCreated({
        id: p.id,
        name: p.name,
        patientNo: p.patientNo,
        species: { id: speciesId, name: sp?.name ?? '', category: sp?.category ?? '' },
        owner: { id: saved.id, displayName: saved.displayName, mobilePhone: saved.mobilePhone },
        alerts: [],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save';
      if (e instanceof ApiError) {
        const f = e.fieldErrors;
        setErrors({
          ...(f.mobilePhone ? { mobile: f.mobilePhone } : {}),
          ...(f.firstName || f.lastName ? { clientName: f.firstName ?? f.lastName } : {}),
          ...(f.name ? { patientName: f.name } : {}),
          ...(f.speciesId ? { speciesId: f.speciesId } : {}),
        });
      }
      setFormError(saved ? `${saved.displayName} was saved as a new client, but the patient was not: ${message}. Correct the patient details and press Save again.` : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3" role="group" aria-label="New client and patient">
      <p className="flex items-center gap-2 text-sm font-medium">
        <UserPlus className="h-4 w-4 text-primary" /> New client and patient
      </p>
      {formError && <FormError message={formError} />}
      {!!existing.data?.length && !client && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This mobile number is already registered to {existing.data.map((d) => `${d.displayName} (${d.clientNo})`).join(', ')}. Search for the number above to use that client instead.
          </span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client full name" htmlFor="qa-client" required error={errors.clientName}>
          <Input id="qa-client" autoComplete="off" value={clientName} disabled={!!client} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Bilal Hussain" />
        </Field>
        <Field label="Mobile" htmlFor="qa-mobile" required error={errors.mobile}>
          <Input id="qa-mobile" type="tel" autoComplete="off" value={mobile} disabled={!!client} onChange={(e) => setMobile(e.target.value)} placeholder="0300 1234567" />
        </Field>
        <Field label="Patient name" htmlFor="qa-patient" required error={errors.patientName}>
          <Input id="qa-patient" autoComplete="off" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="e.g. Moti" />
        </Field>
        <Field label="Species" htmlFor="qa-species" required error={errors.speciesId}>
          <NativeSelect id="qa-species" value={speciesId} onChange={(e) => setSpeciesId(e.target.value)}>
            <option value="">Choose species…</option>
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
        <Field label="Sex (optional)" htmlFor="qa-sex">
          <NativeSelect id="qa-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
            <option value="">Not known</option>
            {PATIENT_SEXES.filter((s) => s !== 'UNKNOWN').map((s) => (
              <option key={s} value={s}>
                {enumLabel(s)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">You can add the address, breed and other details later from the client and patient pages.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" loading={saving} onClick={save}>
          Save and select
        </Button>
      </div>
    </div>
  );
}
