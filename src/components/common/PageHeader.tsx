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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
