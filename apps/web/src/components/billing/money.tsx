'use client';
import { decimalsFor, toMinor } from '@vcms/shared';
import * as React from 'react';
import { Input } from '../ui/input';
import { cn } from '@/lib/utils';

/** Parses a typed amount into minor units; null when empty or invalid. */
export function parseMoney(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  try {
    return toMinor(value, currency);
  } catch {
    return null;
  }
}

/** Amount entry in major units (e.g. "1250.50"); the caller converts with parseMoney. */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { currency: string }>(({ currency, className, ...props }, ref) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currency}</span>
    <Input ref={ref} inputMode="decimal" placeholder={decimalsFor(currency) ? '0.00' : '0'} className={cn('pl-12 tabular', className)} {...props} />
  </div>
));
MoneyInput.displayName = 'MoneyInput';

export const bpToPct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;
