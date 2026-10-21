'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Field } from '../forms/field';
import { FormError } from '../forms/form-error';
import { PatientPicker, type PickedPatient } from '../patients/patient-picker';
import { emptyRepeat, RepeatField, repeatErrors, repeatPayload, type RepeatValue } from './repeat-field';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input, NativeSelect, Textarea } from '../ui/input';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { localDate } from '@/lib/time';
import type { CareItem, CareProtocol } from '@/lib/types';

const OTHER = 'other';

/**
 * Puts a patient on the vaccination list: pick the patient, the vaccine (one of the clinic's approved
 * protocols for that species, or any other by name) and when it is due. A protocol vaccine repeats by itself
 * after it is given; the item then shows in "Due & overdue" and reminders go out as usual.
 */
export function AddVaccinationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { session } = useSession();
  const today = localDate(new Date(), session.branch?.timezone ?? 'UTC');
  const [patient, setPatient] = useState<PickedPatient | null>(null);
  const [choice, setChoice] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState<RepeatValue>(emptyRepeat());
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (open) {
      setPatient(null);
      setChoice('');
      setTitle('');
      setDueDate(today);
      setNotes('');
      setRepeat(emptyRepeat());
      setError(null);
      setTried(false);
    }
    // Reset only when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const protocols = useQuery({ queryKey: ['care-protocols', 'approved'], queryFn: () => api.get<CareProtocol[]>('/care-protocols'), enabled: open, staleTime: 60_000 });
  /** Approved protocols for the patient's species (or for every species), vaccinations first. */
  const options = useMemo(() => {
    const list = (protocols.data ?? []).filter((p) => p.status === 'APPROVED' && (!p.speciesId || !patient || p.speciesId === patient.species.id));
    const groups = new Map<string, CareProtocol[]>();
    for (const p of [...list].sort((a, b) => (a.kind === 'VACCINATION' ? 0 : 1) - (b.kind === 'VACCINATION' ? 0 : 1) || a.name.localeCompare(b.name))) {
      groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
    }
    return groups;
  }, [protocols.data, patient]);

  /** The patient's open items by protocol, so a vaccine they are already down for cannot be added twice. */
  const plan = useQuery({
    queryKey: ['care-plan', patient?.id],
    queryFn: () => api.get<{ items: CareItem[] }>(`/patients/${patient!.id}/care-plan`),
    enabled: open && !!patient,
  });
  const openByProtocol = useMemo(
    () => new Map((plan.data?.items ?? []).filter((i) => i.protocolId && (i.status === 'DUE' || i.status === 'DEFERRED')).map((i) => [i.protocolId!, i])),
    [plan.data],
  );

  // A patient of another species, or one already down for it, may not fit the chosen protocol any more.
  useEffect(() => {
    if (choice && openByProtocol.has(choice)) setChoice('');
  }, [openByProtocol, choice]);

  useEffect(() => {
    if (choice && choice !== OTHER && ![...options.values()].flat().some((p) => p.id === choice)) setChoice('');
  }, [options, choice]);

  const protocol = choice && choice !== OTHER ? [...options.values()].flat().find((p) => p.id === choice) : undefined;
  // A new vaccine starts from its protocol's schedule (or once only); the user can change it.
  useEffect(() => setRepeat(emptyRepeat(!!protocol)), [protocol?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const repeatInvalid = Object.keys(repeatErrors(repeat, dueDate)).length > 0;
  const name = protocol ? protocol.name : title.trim();
  const missing = { patient: !patient, vaccine: !name, due: !dueDate };

  const m = useMutation({
    mutationFn: () =>
      api.post('/care-items', {
        patientId: patient!.id,
        protocolId: protocol?.id ?? null,
        kind: protocol?.kind ?? 'VACCINATION',
        title: name,
        dueDate,
        notes: notes.trim() || null,
        ...repeatPayload(repeat, !!protocol),
      }),
    onSuccess: () => {
      toast.success(`${patient!.name} added: ${name}, due ${fmtDate(dueDate)}`, {
        description: dueDate > today ? 'It shows under “Due within 7 days” or “All open” as the date comes closer.' : undefined,
      });
      qc.invalidateQueries({ queryKey: ['care-items'] });
      qc.invalidateQueries({ queryKey: ['care-plan'] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      setError(/already has an open item/i.test(e.message) ? `${patient?.name ?? 'This patient'} is already on the list for ${name}. Find them under “All open” or on their Care plan tab.` : e.message),
  });

  const submit = () => {
    setTried(true);
    setError(null);
    if (missing.patient || missing.vaccine || missing.due || repeatInvalid) return;
    m.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add patient for vaccination</DialogTitle>
          <DialogDescription>The patient joins the vaccination list with a due date, and the owner gets the usual reminders.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {error && <FormError message={error} />}
          <Field label="Patient" htmlFor="av-patient" required error={tried && missing.patient ? 'Choose the patient' : undefined}>
            <PatientPicker id="av-patient" value={patient} onChange={setPatient} invalid={tried && missing.patient} allowCreate />
          </Field>
          <Field
            label="Vaccine"
            htmlFor="av-vaccine"
            required
            error={tried && missing.vaccine ? (choice === OTHER ? 'Type the vaccine name' : 'Choose the vaccine') : undefined}
            hint={protocols.data && !options.size ? 'No approved protocols yet for this species — type the vaccine name under “Other”.' : undefined}
          >
            <NativeSelect id="av-vaccine" value={choice} onChange={(e) => setChoice(e.target.value)} aria-invalid={tried && missing.vaccine && choice !== OTHER}>
              <option value="">{protocols.isLoading ? 'Loading…' : 'Choose…'}</option>
              {[...options.entries()].map(([kind, list]) => (
                <optgroup key={kind} label={enumLabel(kind)}>
                  {list.map((p) => {
                    const already = openByProtocol.get(p.id);
                    return (
                      <option key={p.id} value={p.id} disabled={!!already}>
                        {p.name}
                        {p.species ? ` (${p.species.name})` : ''}
                        {already ? ` — already due ${fmtDate(already.effectiveDueDate)}` : ''}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
              <option value={OTHER}>Other vaccine (type the name)</option>
            </NativeSelect>
          </Field>
          {choice === OTHER && (
            <Field label="Vaccine name" htmlFor="av-title" required>
              <Input id="av-title" value={title} maxLength={160} autoFocus placeholder="e.g. Rabies booster" onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && missing.vaccine} />
            </Field>
          )}
          <Field label="Due" htmlFor="av-due" required hint="Today if it is being given now." error={tried && missing.due ? 'Choose the due date' : undefined}>
            <Input id="av-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={tried && missing.due} />
          </Field>
          <RepeatField value={repeat} onChange={setRepeat} dueDate={dueDate} hasProtocol={!!protocol} protocolIntervalDays={protocol?.intervalDays} showErrors={tried} idPrefix="av-rp" />
          <Field label="Notes (optional)" htmlFor="av-notes">
            <Textarea id="av-notes" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={submit}>
            Add to vaccination list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
