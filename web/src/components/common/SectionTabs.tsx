import type { ComponentType, ReactNode } from 'react';

import { TabBar } from '@/components/ui';
import { useTabParam } from '@/lib/useTabParam';

export interface Section<K extends string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  render: () => ReactNode;
}

/**
 * A page's sub-menu: one section on screen at a time, the others a click away.
 * The choice lives in the address (`?section=…`), so each section is its own
 * screen — linkable, reloadable, and Back returns to the previous one.
 */
export function SectionTabs<K extends string>({
  sections,
  param = 'section',
  label,
  className = 'mb-6',
}: {
  sections: readonly Section<K>[];
  param?: string;
  label?: string;
  className?: string;
}) {
  const [active, setActive] = useTabParam<K>(sections.map((s) => s.key), sections[0].key, param);
  const current = sections.find((s) => s.key === active) ?? sections[0];
  return (
    <>
      <TabBar className={className} label={label} value={current.key} onChange={setActive} items={sections} />
      {current.render()}
    </>
  );
}
