import { forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

type Variant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'btn-primary-flat',
  accent: 'btn-accent-flat',
  secondary: 'bg-surface-muted text-text hover:bg-border',
  outline: 'hairline bg-surface text-text hover:bg-surface-muted',
  ghost: 'bg-transparent text-text hover:bg-surface-muted',
  // Destructive actions read clearly without shouting: red text on a quiet surface.
  danger: 'hairline bg-surface text-danger hover:bg-danger/5',
};

// One height token drives EVERY button in the app → uniform sizing by construction.
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] min-w-[84px] gap-1.5',
  md: 'h-btn px-btn-x text-sm min-w-[104px] gap-2',
  lg: 'h-12 px-7 text-[15px] min-w-[120px] gap-2',
};

const iconSizes: Record<Size, string> = {
  sm: 'min-w-0 w-9 px-0',
  md: 'min-w-0 w-[var(--yb-btn-height)] px-0',
  lg: 'min-w-0 w-12 px-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, leftIcon, rightIcon, className, children, disabled, ...rest },
  ref,
) {
  // A lone icon (‹ › ✕) is a square button, not a 104px-wide one.
  const iconOnly = !leftIcon && !rightIcon && isValidElement(children) && typeof children.type !== 'string';
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-btn font-medium',
        'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:focus-ring',
        variants[variant],
        sizes[size],
        iconOnly && iconSizes[size],
        fullWidth && 'w-full',
        className,
      )}
      style={{ fontWeight: 'var(--yb-btn-font-weight)' }}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
