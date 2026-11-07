'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enumLabel } from '@vcms/shared';
import Link from 'next/link';
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

/** GET /care-options: approved schedules of one kind and the products behind them, with stock on hand. */
interface CareOptions {
  protocols: { id: string; name: string; kind: string; speciesId: string | null; productId: string | null; intervalDays: number | null; species: { id: string; name: string } | null }[];
  products: { id: string; name: string; dispensingUnit: string; onHand: number }[];
}
interface Opt { value: string; name: string; label: string; protocol?: CareOptions['protocols'][number]; productId: string | null; disabled: boolean }
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Puts a patient on the vaccination (or deworming) list: the patient, the vaccine — from stock, with what is on
 * hand — or one of the clinic's dewormers, and when it is due. With an approved schedule it repeats by itself after
 * it is given; recording it starts with the product chosen here. It shows in "Due & overdue" and reminders go out.
 */
export function AddVaccinationDialog({
  open,
  onOpenChange,
  patient: fixedPatient,
  kind,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Already known (e.g. from a consultation): the patient picker is not shown. */
  patient?: PickedPatient | null;
  /** Vaccination (default) or deworming: only that kind of protocol is offered. */
  kind?: 'VACCINATION' | 'DEWORMING';
  onAdded?: (item: CareItem) => void;
}) {
  const worming = kind === 'DEWORMING';
  const what = worming ? 'deworming' : 'vaccination';
  const thing = worming ? 'Dewormer' : 'Vaccine';
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
      setPatient(fixedPatient ?? null);
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

  // Vaccines come from stock (every active vaccine, with what is on hand); dewormers from the clinic's own list.
  const k = kind ?? 'VACCINATION';
  const opts = useQuery({ queryKey: ['care-options', k], queryFn: () => api.get<CareOptions>(`/care-options?kind=${k}`), enabled: open, staleTime: 30_000 });

  /** The patient's open items, so something they are already down for cannot be added twice. */
  const plan = useQuery({
    queryKey: ['care-plan', patient?.id],
    queryFn: () => api.get<{ items: CareItem[] }>(`/patients/${patient!.id}/care-plan`),
    enabled: open && !!patient,
  });
  const openItems = useMemo(() => (plan.data?.items ?? []).filter((i) => i.status === 'DUE' || i.status === 'DEFERRED'), [plan.data]);

  const options = useMemo<Opt[]>(() => {
    const data = opts.data;
    if (!data) return [];
    const fits = (p: CareOptions['protocols'][number]) => !p.speciesId || !patient || p.speciesId === patient.species.id;
    const stock = (id: string | null) => data.products.find((x) => x.id === id);
    const stockText = (pr?: CareOptions['products'][number]) => (!pr ? '' : pr.onHand > 0 ? ` · ${qtyText(pr.onHand)} ${pr.dispensingUnit} in stock` : ' · none in stock');
    if (k === 'VACCINATION') {
      return data.products.map((pr) => {
        const protocol = data.protocols.find((p) => p.productId === pr.id && fits(p));
        const already = openItems.find((i) => (protocol && i.protocolId === protocol.id) || i.productId === pr.id);
        return {
          value: `p:${pr.id}`,
          name: protocol?.name ?? pr.name,
          label: `${pr.name}${protocol && protocol.name !== pr.name ? ` — ${protocol.name}` : ''}${stockText(pr)}${already ? ` — already due ${fmtDate(already.effectiveDueDate)}` : ''}`,
          protocol,
          productId: pr.id,
          disabled: !!already,
        };
      });
    }
    return data.protocols.filter(fits).map((p) => {
      const already = openItems.find((i) => i.protocolId === p.id);
      return {
        value: `r:${p.id}`,
        name: p.name,
        label: `${p.name}${p.species ? ` (${p.species.name})` : ''}${stockText(stock(p.productId))}${already ? ` — already due ${fmtDate(already.effectiveDueDate)}` : ''}`,
        protocol: p,
        productId: p.productId,
        disabled: !!already,
      };
    });
  }, [opts.data, patient, k, openItems]);

  // A patient of another species, or one already down for it, may not fit the chosen option any more.
  useEffect(() => {
    if (choice && choice !== OTHER && !options.some((o) => o.value === choice && !o.disabled)) setChoice('');
  }, [options, choice]);

  const picked = choice && choice !== OTHER ? options.find((o) => o.value === choice) : undefined;
  const protocol = picked?.protocol;
  // A new item starts from its schedule (or once only); the user can change it.
  useEffect(() => setRepeat(emptyRepeat(!!protocol)), [protocol?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const repeatInvalid = Object.keys(repeatErrors(repeat, dueDate)).length > 0;
  const name = picked ? picked.name : title.trim();
  const missing = { patient: !patient, vaccine: !name, due: !dueDate };
  const noStock = k === 'VACCINATION' && !!opts.data && !opts.data.products.length;

  const m = useMutation({
    mutationFn: () =>
      api.post<CareItem>('/care-items', {
        patientId: patient!.id,
        protocolId: protocol?.id ?? null,
        productId: picked?.productId ?? null,
        kind: k,
        title: name,
        dueDate,
        notes: notes.trim() || null,
        ...repeatPayload(repeat, !!protocol),
      }),
    onSuccess: (item) => {
      onAdded?.(item);
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
          <DialogTitle>{fixedPatient ? `Add ${fixedPatient.name} for ${what}` : `Add patient for ${what}`}</DialogTitle>
          <DialogDescription>{fixedPatient ? `Choose the ${thing.toLowerCase()}. It is due today — record it as given once it is done, and the next one is scheduled automatically.` : `The patient joins the ${what} list with a due date, and the owner gets the usual reminders.`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {error && <FormError message={error} />}
          {!fixedPatient && (
            <Field label="Patient" htmlFor="av-patient" required error={tried && missing.patient ? 'Choose the patient' : undefined}>
              <PatientPicker id="av-patient" value={patient} onChange={setPatient} invalid={tried && missing.patient} allowCreate />
            </Field>
          )}
          <Field
            label={thing}
            htmlFor="av-vaccine"
            required
            error={tried && missing.vaccine ? (choice === OTHER ? `Type the ${thing.toLowerCase()} name` : `Choose the ${thing.toLowerCase()}`) : undefined}
            hint={
              noStock ? (
                <>
                  No vaccines in stock yet. Add them in <Link href="/inventory/catalog" className="text-primary underline">Inventory</Link> as type “Vaccine” and receive stock.
                </>
              ) : worming && opts.data && !options.length ? (
                <>
                  No dewormers yet for this species — add your clinic’s dewormers on the <Link href="/deworming?tab=dewormers" className="text-primary underline">Deworming</Link> page, or type the name under “Other”.
                </>
              ) : !worming ? (
                'Vaccines in your stock. A vaccine with an approved schedule repeats by itself after it is given.'
              ) : undefined
            }
          >
            <NativeSelect id="av-vaccine" value={choice} onChange={(e) => setChoice(e.target.value)} aria-invalid={tried && missing.vaccine && choice !== OTHER}>
              <option value="">{opts.isLoading ? 'Loading…' : 'Choose…'}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
              {worming && <option value={OTHER}>Other {thing.toLowerCase()} (type the name)</option>}
            </NativeSelect>
          </Field>
          {choice === OTHER && (
            <Field label={`${thing} name`} htmlFor="av-title" required>
              <Input id="av-title" value={title} maxLength={160} autoFocus placeholder={worming ? 'e.g. Praziquantel tablet' : 'e.g. Rabies booster'} onChange={(e) => setTitle(e.target.value)} aria-invalid={tried && missing.vaccine} />
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
            {fixedPatient ? 'Add' : `Add to ${what} list`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
