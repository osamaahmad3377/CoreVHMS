'use client';
import { PLAN_FEATURES, PLAN_FEATURE_INFO, type PlanFeature, type PlatformPlan } from '@vcms/shared';
import { Check, Minus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/** "Rs 12,000" for a plan's monthly price (minor units). */
export function planPrice(p: Pick<PlatformPlan, 'priceMonthlyMinor' | 'currency'>) {
  const major = p.priceMonthlyMinor / 100;
  if (!major) return 'Free';
  return `${p.currency === 'AUD' ? 'A$' : 'Rs '}${major.toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

export const limitText = (n: number | null) => (n === null ? 'No limit' : String(n));

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
