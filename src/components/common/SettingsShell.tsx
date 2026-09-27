import { useEffect, useRef, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';

export interface SettingsSection {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
}

/**
 * The settings frame shared by the operator and platform consoles: the section
 * menu (a side list on wide screens, a sideways-scrolling row on phones) with a
 * grid of section cards on /settings, or the open section's page.
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr] md:gap-6">
        <nav
          ref={nav}
          aria-label={`${title} sections`}
          className={cn(
            'no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:overflow-visible md:px-0',
            isHub && 'hidden md:flex',
          )}
        >
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) => cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition',
                isActive ? 'bg-primary/10 font-medium text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text',
              )}
            >
              <s.icon className="h-4 w-4" /> {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {isHub ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sections.map((s) => (
                <NavLink key={s.to} to={s.to} className="flex flex-col gap-2 rounded-xl border border-border p-4 transition hover:border-primary/40 hover:bg-surface-muted">
                  <s.icon className="h-5 w-5 text-primary" />
                  <div className="font-medium text-text">{s.label}</div>
                  <div className="text-xs text-text-muted">{s.description}</div>
                </NavLink>
              ))}
            </div>
          ) : <Outlet />}
        </div>
      </div>
    </>
  );
}
