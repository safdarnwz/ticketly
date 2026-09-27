import type { ReactNode } from 'react';

import { BackButton } from '@/components/layout/BackButton';

export function PageHeader({ title, subtitle, action, back, backTo }: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: boolean;
  backTo?: string;
}) {
  return (
    <div className="mb-6">
      {back && (
        <div className="mb-2">
          <BackButton to={backTo} />
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-text">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {action && <div className="flex max-w-full flex-wrap gap-2 [&>*]:flex-wrap">{action}</div>}
      </div>
    </div>
  );
}
