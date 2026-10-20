import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-primary/20 bg-primary/10 text-primary dark:bg-primary/20',
      secondary: 'border-border/60 bg-secondary text-secondary-foreground',
      destructive: 'border-destructive/20 bg-destructive/10 text-destructive dark:bg-destructive/25',
      warning: 'border-warning/25 bg-warning/15 text-warning dark:bg-warning/25',
      success: 'border-success/20 bg-success/12 text-success dark:bg-success/25',
      info: 'border-info/20 bg-info/10 text-info dark:bg-info/25',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
