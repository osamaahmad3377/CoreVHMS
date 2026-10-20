'use client';
import * as React from 'react';
import type { FieldError, FieldErrors } from 'react-hook-form';
import { CircleHelp } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: FieldError | { message?: string } | string;
  hint?: React.ReactNode;
  /** A short plain-language explanation, shown when the person taps the small "?" next to the label. */
  help?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + error/hint with correct aria wiring. */
/** A small "?" that opens a short explanation. Works with a tap, a click or the keyboard. */
export function HelpTip({ children, label = 'What is this?' }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-sm font-normal leading-snug">{children}</PopoverContent>
    </Popover>
  );
}

export function Field({ label, htmlFor, error, hint, help, required, className, children }: FieldProps) {
  const message = typeof error === 'string' ? error : error?.message;
  const id = htmlFor;
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <div className="flex min-h-5 items-center gap-1">
        <Label htmlFor={id} className={cn(message && 'text-destructive')}>
          {label}
          {required && (
            <span className="text-destructive" aria-hidden>
              {' '}
              *
            </span>
          )}
        </Label>
        {help && <HelpTip>{help}</HelpTip>}
      </div>
      {React.isValidElement(children) && id
        ? React.cloneElement(children as React.ReactElement<any>, {
            'aria-invalid': message ? true : undefined,
            'aria-required': required || undefined,
            'aria-describedby': message ? `${id}-error` : hint ? `${id}-hint` : undefined,
          })
        : children}
      {message ? (
        <p id={id ? `${id}-error` : undefined} className="text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : hint ? (
        <p id={id ? `${id}-hint` : undefined} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Applies API validation errors (by dotted path) to a react-hook-form instance. */
export function applyServerErrors(
  fieldErrors: Record<string, string>,
  setError: (name: any, error: { type: string; message: string }) => void,
) {
  for (const [path, message] of Object.entries(fieldErrors)) setError(path, { type: 'server', message });
}

export function errorAt(errors: FieldErrors, path: string): FieldError | undefined {
  return path.split('.').reduce<any>((acc, k) => acc?.[k], errors);
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b pb-6 last:border-0 md:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}
