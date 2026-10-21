import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold transition-[transform,box-shadow,background-color,filter,color] duration-200 ease-apple focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Primary: the one main action on a screen. Solid brand colour with a soft glow and a glassy sheen.
        default: 'bg-primary bg-gradient-to-b from-white/[0.16] to-transparent text-primary-foreground shadow-glow hover:-translate-y-px hover:brightness-110 active:translate-y-0 active:brightness-95',
        destructive: 'bg-destructive bg-gradient-to-b from-white/[0.14] to-transparent text-destructive-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.2),0_6px_18px_-6px_hsl(var(--destructive)/0.55)] hover:-translate-y-px hover:brightness-110 active:translate-y-0',
        // Secondary actions: frosted glass.
        outline: 'surface-flat text-foreground shadow-[inset_0_1px_0_hsl(var(--glass-highlight)),0_1px_2px_hsl(var(--shadow)/0.06)] hover:bg-[hsl(var(--glass)/0.85)] hover:shadow-[inset_0_1px_0_hsl(var(--glass-highlight)),0_4px_12px_-4px_hsl(var(--shadow)/0.15)]',
        secondary: 'bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20 dark:bg-primary/15 dark:hover:bg-primary/25',
        ghost: 'text-foreground/85 hover:bg-foreground/[0.06] active:bg-foreground/10',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5',
        sm: 'h-9 px-4 text-[0.8125rem]',
        lg: 'h-12 px-8 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
