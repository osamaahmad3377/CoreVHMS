'use client';
import * as React from 'react';
import type { FieldError, FieldErrors } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: FieldError | { message?: string } | string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + error/hint with correct aria wiring. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const message = typeof error === 'string' ? error : error?.message;
  const id = htmlFor;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className={cn(message && 'text-destructive')}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden>
            {' '}
            *
          </span>
        )}
      </Label>
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
