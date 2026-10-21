import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-2xs font-semibold ring-1 ring-inset', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary ring-primary/20 dark:bg-primary/20',
      secondary: 'border-transparent bg-foreground/[0.06] text-foreground/80 ring-foreground/10',
      destructive: 'border-transparent bg-destructive/10 text-destructive ring-destructive/20 dark:bg-destructive/20',
      warning: 'border-transparent bg-warning/10 text-warning ring-warning/25 dark:bg-warning/20',
      success: 'border-transparent bg-success/10 text-success ring-success/20 dark:bg-success/20',
      info: 'border-transparent bg-info/10 text-info ring-info/20 dark:bg-info/20',
      outline: 'border-transparent text-foreground ring-foreground/15',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
