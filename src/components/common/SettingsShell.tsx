import { useEffect, useRef, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';

export interface SettingsSection {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
}

/**
 * The settings frame shared by the operator and platform consoles: on /settings
 * a grid of section cards; inside a section, the section menu — a side list on
 * wide screens, a sideways-scrolling pill row on phones — and the section page.
 */
export function SettingsShell({ title, subtitle, sections }: { title: string; subtitle: string; sections: readonly SettingsSection[] }) {
  const location = useLocation();
  const isHub = location.pathname === '/settings';
  const nav = useRef<HTMLElement>(null);
  // Phones: bring the open section's pill into view (sideways only, the page does not jump).
  useEffect(() => {
    const el = nav.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && active && el.scrollWidth > el.clientWidth) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
  }, [location.pathname]);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {isHub ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <NavLink key={s.to} to={s.to} className="lift flex items-start gap-3 rounded-card bg-surface p-4 shadow-card">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><s.icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-text">{s.label}</span>
                <span className="block text-xs text-text-muted">{s.description}</span>
              </span>
              <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-text-muted" />
            </NavLink>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr] md:gap-6">
          <nav ref={nav} aria-label={`${title} sections`} className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0">
            {sections.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                className={({ isActive }) => cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-3.5 py-2 text-sm font-semibold transition md:rounded-xl md:px-3',
                  isActive ? 'bg-surface text-text shadow-sm md:bg-accent/10 md:text-accent md:shadow-none' : 'text-text-muted hover:bg-surface-muted hover:text-text',
                )}
              >
                <s.icon className="h-4 w-4" /> {s.label}
              </NavLink>
            ))}
          </nav>
          <div className="min-w-0"><Outlet /></div>
        </div>
      )}
    </>
  );
}
