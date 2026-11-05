'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { discountLabel, type ClinicOverview, type DiscountType } from '@vcms/shared';
import { BadgePercent } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, NativeSelect } from '@/components/ui/input';
import { useConfirm } from '@/components/confirm';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { amount } from './plan-ui';

const endOfDay = (day: string) => new Date(`${day}T23:59:00`).toISOString();
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const tomorrow = () => new Date(Date.now() + 86400_000).toLocaleDateString('en-CA');
/** Amounts are typed in rupees / dollars and stored in minor units. */
const toMajor = (minor: number | null) => (minor == null ? '' : String(minor / 100));

/**
 * A discount for one clinic on its NextCore fee: a percentage, or a fixed amount off each month (12 times that off a
 * year paid upfront), optionally until a date. It comes off the whole fee — plan and extras — and the owner sees it
 * on their plan page.
 */
export function ClinicDiscountCard({ overview }: { overview: ClinicOverview }) {
  const c = overview.clinic;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const currency = c.bill?.currency ?? 'PKR';
  const savedValue = c.discountType === 'AMOUNT' ? toMajor(c.discountValue) : c.discountValue != null ? String(c.discountValue) : '';
  const [type, setType] = useState<DiscountType | ''>(c.discountType ?? '');
  const [value, setValue] = useState(savedValue);
  const [until, setUntil] = useState(dayOf(c.discountEndsAt));
  const [note, setNote] = useState(c.discountNote ?? '');
  const ended = !!c.discountType && !c.bill?.discount && !!c.discountEndsAt && new Date(c.discountEndsAt) <= new Date();

  const num = Number(value);
  const valid = type === 'PERCENT' ? Number.isInteger(num) && num >= 1 && num <= 100 : type === 'AMOUNT' ? num > 0 && Math.round(num * 100) === num * 100 : false;
  const dirty = type !== (c.discountType ?? '') || (type !== '' && (value !== savedValue || until !== dayOf(c.discountEndsAt) || note !== (c.discountNote ?? '')));

  const save = useMutation({
    mutationFn: (discount: { type: DiscountType; value: number; endsAt: string | null; note: string } | null) => api.put(`/platform/clinics/${c.id}/discount`, { discount }),
    onSuccess: (_, d) => {
      toast.success(d ? `Discount saved — ${discountLabel(d, currency)}` : 'Discount removed');
      for (const key of ['platform-clinic', 'platform-clinics', 'platform-billing-summary']) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = () => save.mutate({ type: type as DiscountType, value: type === 'AMOUNT' ? Math.round(num * 100) : num, endsAt: until ? endOfDay(until) : null, note: note.trim() });
  const remove = async () => {
    const r = await confirm({ title: 'Remove this clinic’s discount?', description: 'From now on the clinic is charged its full fee. Payments already recorded don’t change.', confirmLabel: 'Remove discount', destructive: true });
    if (r.confirmed) save.mutate(null);
  };

  // What the new discount is worth on today's monthly fee (extras included).
  const full = c.bill?.fullMonthlyFeeMinor ?? 0;
  const off = c.bill && valid ? Math.min(full, type === 'PERCENT' ? Math.round((full * num) / 100) : Math.round(num * 100)) : null;
  const bill = c.bill;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BadgePercent className="h-4 w-4" /> Discount</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {bill?.discount ? (
          <div className="rounded-lg bg-success/10 p-3 text-sm ring-1 ring-inset ring-success/20">
            <p className="font-medium text-success">{discountLabel(bill.discount, currency)}{bill.discount.endsAt ? ` until ${fmtDate(bill.discount.endsAt)}` : ' — no end date'}</p>
            <p className="text-xs text-muted-foreground">Already taken off the fee. {bill.discount.note ? `Note: ${bill.discount.note}` : ''}</p>
          </div>
        ) : ended ? (
          <p className="text-sm text-muted-foreground">The discount ({discountLabel({ type: c.discountType!, value: c.discountValue! }, currency)}) ended on {fmtDate(c.discountEndsAt!)}. The clinic pays its full fee.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No discount — the clinic pays its plan’s price. Give one here, e.g. 20% off for the first 6 months.</p>
        )}

        <Field label="Discount" htmlFor="d-type">
          <NativeSelect id="d-type" value={type} onChange={(e) => { setType(e.target.value as DiscountType | ''); setValue(''); }}>
            <option value="">No discount</option>
            <option value="PERCENT">A percentage off</option>
            <option value="AMOUNT">A fixed amount off each month</option>
          </NativeSelect>
        </Field>
        {type && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={type === 'PERCENT' ? 'Percent off' : `Amount off a month (${currency === 'AUD' ? 'A$' : 'Rs'})`} htmlFor="d-value" hint={type === 'AMOUNT' ? '12 times this comes off a year paid upfront.' : 'Off the whole fee, extras included.'}>
                <div className="relative">
                  <Input id="d-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} className={type === 'PERCENT' ? 'pr-8' : undefined} />
                  {type === 'PERCENT' && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
                </div>
              </Field>
              <Field label="Until" htmlFor="d-until" hint={until ? undefined : 'Empty: until you remove it'}>
                <Input id="d-until" type="date" min={tomorrow()} value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            </div>
            <Field label="Note" htmlFor="d-note" hint="Why — for your records and the clinic’s history.">
              <Input id="d-note" maxLength={200} value={note} placeholder="e.g. Launch offer, referral, long-standing client" onChange={(e) => setNote(e.target.value)} />
            </Field>
            {off != null && (
              <p className="rounded-lg bg-muted/50 p-2.5 text-xs">
                Paying monthly: <b>{amount(full, currency)}</b> − {amount(off, currency)} = <b>{amount(full - off, currency)}</b> a month, with today’s extras.
              </p>
            )}
            {value !== '' && !valid && <p className="text-xs text-destructive">{type === 'PERCENT' ? 'Enter a whole number from 1 to 100.' : 'Enter an amount more than 0.'}</p>}
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Not saved yet</span>}
          {type ? (
            <>
              {c.discountType && <Button variant="ghost" className="text-destructive" disabled={save.isPending} onClick={remove}>Remove</Button>}
              <Button disabled={!dirty || !valid} loading={save.isPending} onClick={submit}>Save discount</Button>
            </>
          ) : (
            <Button variant="destructive" disabled={!c.discountType} loading={save.isPending} onClick={remove}>Remove discount</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
