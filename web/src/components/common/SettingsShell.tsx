import type { ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

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
 * menu (a side list on wide screens, a section picker on smaller ones — never
 * a sideways-scrolling row) with a
 * grid of section cards on /settings, or the open section's page.
 */
export function SettingsShell({ title, subtitle, sections }: { title: string; subtitle: string; sections: readonly SettingsSection[] }) {
  const location = useLocation();
  const isHub = location.pathname === '/settings';
  const navigate = useNavigate();
  const current = sections.find((s) => location.pathname.startsWith(s.to));

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {!isHub && (
        <label className="mb-4 block xl:hidden">
          <span className="mb-1.5 block text-sm text-text-muted">Section</span>
          <select
            value={current?.to ?? ''}
            onChange={(e) => navigate(e.target.value)}
            className="h-input w-full rounded-input border border-border bg-surface px-input-x text-sm text-text"
          >
            {sections.map((s) => <option key={s.to} value={s.to}>{s.label}</option>)}
          </select>
        </label>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-6">
        <nav aria-label={`${title} sections`} className="hidden flex-col gap-1 xl:flex">
          {sections.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) => cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
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
