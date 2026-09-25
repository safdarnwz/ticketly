import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Palette, Languages, UserRound } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { to: '/settings/appearance', label: 'Appearance', icon: Palette, description: 'The design system for the WHOLE platform' },
  { to: '/settings/i18n', label: 'i18n & Currency', icon: Languages, description: 'Shared translation and FX-rate catalog' },
  { to: '/settings/privacy', label: 'Privacy (DPDP)', icon: UserRound, description: 'Data-subject access/erasure requests' },
];

/** Platform-wide configuration lives here — one place, separate from day-to-day cross-tenant admin work (Operators, Applications, Analytics). */
export function PlatformSettingsPage() {
  const location = useLocation();
  const isHub = location.pathname === '/settings';

  return (
    <>
      <PageHeader title="Settings" subtitle="Platform-wide configuration — appearance, localization, and privacy" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to}
              className={({ isActive }) => cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition',
                isActive ? 'bg-primary/10 font-medium text-primary' : 'text-text-muted hover:bg-surface-muted hover:text-text',
              )}>
              <s.icon className="h-4 w-4" /> {s.label}
            </NavLink>
          ))}
        </nav>
        <div>
          {isHub ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SECTIONS.map((s) => (
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
