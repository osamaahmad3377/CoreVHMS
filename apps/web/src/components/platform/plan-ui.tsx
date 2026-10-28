'use client';
import { PLAN_FEATURES, PLAN_FEATURE_INFO, STORAGE_PACK_GB, type BillingCycle, type ClinicBill, type PlanFeature, type PlatformPlan } from '@vcms/shared';
import { Check, Minus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/** "Rs 12,000" for a plan's monthly price (minor units). */
export function planPrice(p: Pick<PlatformPlan, 'priceMonthlyMinor' | 'currency'>) {
  const major = p.priceMonthlyMinor / 100;
  if (!major) return 'Free';
  return `${p.currency === 'AUD' ? 'A$' : 'Rs '}${major.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

/** "Rs 500" for any amount in minor units. */
export const amount = (minor: number, currency: string) => planPrice({ priceMonthlyMinor: minor, currency }).replace(/^Free$/, currency === 'AUD' ? 'A$0' : 'Rs 0');

/** The lines of a clinic's monthly bill: the plan, then each kind of extra as "3 extra staff × Rs 500". */
export function billLines(bill: ClinicBill, planName: string, cycle: BillingCycle) {
  const lines = [{ label: `${planName} plan${cycle === 'YEARLY' ? ' (yearly ÷ 12)' : ''}`, minor: bill.planMinor }];
  const each = (n: number, what: string, price: number | null) => `${n} ${what}${price != null ? ` × ${amount(price, bill.currency)}` : ''}`;
  if (bill.extraStaff) lines.push({ label: each(bill.extraStaff, 'extra staff', bill.extraStaffMinor), minor: bill.extraStaff * (bill.extraStaffMinor ?? 0) });
  if (bill.extraBranches) lines.push({ label: each(bill.extraBranches, `extra branch${bill.extraBranches === 1 ? '' : 'es'}`, bill.extraBranchMinor), minor: bill.extraBranches * (bill.extraBranchMinor ?? 0) });
  if (bill.extraStoragePacks) lines.push({ label: `${bill.extraStoragePacks * STORAGE_PACK_GB} GB extra storage${bill.extraStorageMinor != null ? ` (${bill.extraStoragePacks} × ${amount(bill.extraStorageMinor, bill.currency)})` : ''}`, minor: bill.extraStoragePacks * (bill.extraStorageMinor ?? 0) });
  return lines;
}

/** "Starter Rs 6,800 + 3 extra staff × Rs 500" on one line. */
export const billSummary = (bill: ClinicBill, planName: string, cycle: BillingCycle) =>
  billLines(bill, planName, cycle).map((l, i) => (i === 0 ? `${planName} ${amount(l.minor, bill.currency)}` : l.label)).join(' + ');

/** A clinic's monthly bill as a small receipt: the plan, each extra and the total. */
export function BillBreakdown({ bill, planName, cycle, className }: { bill: ClinicBill; planName: string; cycle: BillingCycle; className?: string }) {
  return (
    <dl className={cn('grid gap-1 text-sm', className)}>
      {billLines(bill, planName, cycle).map((l) => (
        <div key={l.label} className="flex items-baseline justify-between gap-3">
          <dt className="min-w-0 text-muted-foreground">{l.label}</dt>
          <dd className="shrink-0 tabular-nums">{amount(l.minor, bill.currency)}</dd>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1.5 font-semibold">
        <dt>{bill.inTrial ? 'A month after the free trial' : 'Total a month'}</dt>
        <dd className="shrink-0 tabular-nums">{amount(bill.planMinor + bill.extrasMinor, bill.currency)}</dd>
      </div>
    </dl>
  );
}

export const limitText = (n: number | null) => (n === null ? 'No limit' : String(n));
/** "6" or "unlimited", inside a sentence ("unlimited staff"). */
export const limitWord = (n: number | null) => (n === null ? 'unlimited' : String(n));

/** Which features are in: a tick or a dash for each, in catalogue order. */
export function FeatureList({ features, compact }: { features: readonly PlanFeature[]; compact?: boolean }) {
  return (
    <ul className={cn('grid gap-1 text-sm', compact ? 'grid-cols-2' : '')}>
      {PLAN_FEATURES.map((f) => {
        const on = features.includes(f);
        return (
          <li key={f} className={cn('flex items-center gap-1.5', !on && 'text-muted-foreground/70')}>
            {on ? <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Included" /> : <Minus className="h-3.5 w-3.5 shrink-0" aria-label="Not included" />}
            {PLAN_FEATURE_INFO[f].label}
          </li>
        );
      })}
    </ul>
  );
}

/** Tick boxes for the features, with what each one covers. */
export function FeaturePicker({ value, onChange, idPrefix = 'f' }: { value: readonly PlanFeature[]; onChange: (v: PlanFeature[]) => void; idPrefix?: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {PLAN_FEATURES.map((f) => (
        <label key={f} htmlFor={`${idPrefix}-${f}`} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 text-sm hover:bg-muted">
          <Checkbox
            id={`${idPrefix}-${f}`}
            checked={value.includes(f)}
            onCheckedChange={(c) => onChange(PLAN_FEATURES.filter((x) => (x === f ? c === true : value.includes(x))))}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium">{PLAN_FEATURE_INFO[f].label}</span>
            <span className="block text-xs text-muted-foreground">{PLAN_FEATURE_INFO[f].description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
