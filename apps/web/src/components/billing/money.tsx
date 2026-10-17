'use client';
import { decimalsFor, toMinor } from '@vcms/shared';
import * as React from 'react';
import { Input } from '../ui/input';
import { fmtMoney } from '@/lib/format';
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

/** The short symbol staff see on screen: "Rs" for rupees (never "PKR"), "$" for dollars. */
export function currencySymbol(currency: string) {
  if (currency === 'PKR') return 'Rs';
  try {
    return new Intl.NumberFormat(currency === 'AUD' ? 'en-AU' : 'en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Amount entry in major units (e.g. "1250.50"); the caller converts with parseMoney. */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { currency: string }>(({ currency, className, ...props }, ref) => (
  <div className="relative min-w-0">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{currencySymbol(currency)}</span>
    <Input ref={ref} inputMode="decimal" placeholder={decimalsFor(currency) ? '0.00' : '0'} className={cn('pl-10 tabular', className)} {...props} />
  </div>
));
MoneyInput.displayName = 'MoneyInput';

/**
 * A client's account balance as text: what they owe ("Rs 1,000.00"), or credit ("Rs 1,000.00 credit"),
 * never a minus sign.
 */
export function fmtBalance(minor: number, currency: string) {
  return minor < 0 ? `${fmtMoney(-minor, currency)} credit` : fmtMoney(minor, currency);
}

/** Account balance for tables and headers: amount owed in amber, credit in green with the word "credit". */
export function AccountBalance({ minor, currency, className }: { minor: number; currency: string; className?: string }) {
  return (
    <span className={cn('tabular', minor > 0 ? 'font-medium text-warning' : minor < 0 ? 'font-medium text-success' : 'text-muted-foreground', className)}>
      {fmtBalance(minor, currency)}
    </span>
  );
}

export const bpToPct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;
