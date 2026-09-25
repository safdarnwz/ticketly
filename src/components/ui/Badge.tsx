import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-text-muted ring-1 ring-inset ring-border',
  success: 'bg-success/10 text-success ring-1 ring-inset ring-success/20',
  warning: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
  danger: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/20',
  info: 'bg-info/10 text-info ring-1 ring-inset ring-info/20',
  primary: 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
};

/** Maps common backend statuses to a tone so badges are consistent app-wide. */
export function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (['confirmed', 'settled', 'processed', 'published', 'active', 'resolved', 'allow', 'paid'].includes(s)) return 'success';
  if (['held', 'pending', 'processing', 'review', 'draft', 'open'].includes(s)) return 'warning';
  if (['cancelled', 'failed', 'deny', 'expired', 'closed', 'rejected'].includes(s)) return 'danger';
  if (['completed', 'confirmed'].includes(s)) return 'info';
  return 'neutral';
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}
