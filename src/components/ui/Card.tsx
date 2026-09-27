import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Subtle border emphasis on hover — for interactive/clickable cards. */
  interactive?: boolean;
  /** A flat crimson accent hairline across the top edge — for highlighted cards. */
  accent?: boolean;
}

export function Card({ className, interactive, accent, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'relative rounded-card border border-transparent bg-surface shadow-card',
        interactive && 'lift cursor-pointer',
        accent && 'before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:rounded-t-card before:bg-[color:var(--yb-color-accent)]',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border p-card">
      <div>
        <h3 className="font-display text-lg text-text">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-card', className)} {...rest} />;
}
