import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/**
 * The one tab bar for console pages: a pill segmented control that scrolls
 * sideways on a phone instead of pushing the page wider.
 */
export function TabBar<K extends string>({ items, value, onChange, className, label }: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('no-scrollbar -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0', className)}>
      <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-pill bg-surface-muted p-1">
        {items.map(({ key, label: text, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 py-1.5 text-sm font-semibold transition',
              value === key ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            {Icon && <Icon className={cn('h-4 w-4', value === key && 'text-accent')} />} {text}
          </button>
        ))}
      </div>
    </div>
  );
}
