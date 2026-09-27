import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * The one tab strip for console pages: underlined tabs on a hairline, which
 * scroll sideways on a phone instead of pushing the page wider.
 */
export function TabBar<K extends string>({ items, value, onChange, className, label }: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('no-scrollbar flex gap-2 overflow-x-auto border-b border-border', className)}>
      {items.map(({ key, label: text, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            value === key ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text',
          )}
        >
          {Icon && <Icon className="h-4 w-4" />} {text}
        </button>
      ))}
    </div>
  );
}
