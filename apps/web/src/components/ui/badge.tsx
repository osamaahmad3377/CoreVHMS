import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary dark:bg-primary/20',
      secondary: 'border-transparent bg-foreground/[0.06] text-foreground/80',
      destructive: 'border-transparent bg-destructive/10 text-destructive dark:bg-destructive/25',
      warning: 'border-transparent bg-warning/15 text-warning dark:bg-warning/25',
      success: 'border-transparent bg-success/12 text-success dark:bg-success/25',
      info: 'border-transparent bg-info/10 text-info dark:bg-info/25',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
