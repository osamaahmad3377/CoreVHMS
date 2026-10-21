import * as React from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'flex h-10 w-full rounded-lg border border-foreground/[0.1] bg-[hsl(var(--glass)/0.55)] px-4 py-1 text-sm shadow-[inset_0_1px_2px_hsl(var(--shadow)/0.05)] transition-[background-color,border-color,box-shadow] duration-200 ease-apple placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-primary/60 focus-visible:bg-[hsl(var(--glass)/0.92)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive/70 aria-[invalid=true]:bg-destructive/[0.04] aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/15';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn(inputClass, 'file:border-0 file:bg-transparent file:text-sm file:font-medium', className)} ref={ref} {...props} />
));
Input.displayName = 'Input';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea className={cn(inputClass, 'h-auto min-h-[72px] py-2', className)} ref={ref} {...props} />
));
Textarea.displayName = 'Textarea';

/** Native select: fully keyboard/screen-reader accessible and works with react-hook-form register(). */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      inputClass,
      'appearance-none bg-[image:url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%236b7b80%22%3E%3Cpath%20d%3D%22M5.3%207.3a1%201%200%20011.4%200L10%2010.6l3.3-3.3a1%201%200%20111.4%201.4l-4%204a1%201%200%2001-1.4%200l-4-4a1%201%200%20010-1.4z%22%2F%3E%3C%2Fsvg%3E")] bg-[length:1.1rem] bg-[right_0.5rem_center] bg-no-repeat pr-8',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export { Input, NativeSelect, Textarea };
