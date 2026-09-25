import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftIcon, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-text">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-input w-full rounded-input border bg-surface px-input-x text-sm text-text',
            'placeholder:text-text-muted focus-ring transition-colors',
            'hover:border-primary/30 focus:border-primary',
            leftIcon && 'pl-9',
            error ? 'border-danger' : 'border-border',
            className,
          )}
          style={{ borderWidth: 'var(--yb-input-border-width)' }}
          {...rest}
        />
      </div>
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-text-muted">{hint}</span>
      ) : null}
    </div>
  );
});
