import { NavLink } from 'react-router-dom';
import { Bus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { isSuperAdmin, SURFACE_TENANT_SLUG } from '@/lib/host';

import { useConsoleNav } from './consoleNav';

const FOOTER = { platform: 'Ticketly Platform Admin', agent: 'Ticketly Agent Portal', crew: 'Ticketly Crew App', operator: 'Ticketly Console' };

/** Logo, menu and footer — the desktop sidebar and the phone drawer share it. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { nav, kind } = useConsoleNav();
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-fg">
          <Bus className="h-5 w-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-xl text-text">Ticketly</span>
          {!isSuperAdmin && SURFACE_TENANT_SLUG && (
            <span className="text-xs text-text-muted">{SURFACE_TENANT_SLUG}</span>
          )}
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Console">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/agent' || to === '/crew'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-surface-muted text-text'
                  : 'text-text-muted hover:bg-surface-muted hover:text-text',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent" />
                )}
                <Icon className={cn('h-[18px] w-[18px]', isActive && 'text-accent')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-4 text-xs leading-relaxed text-text-muted">
        {FOOTER[kind]} · v1.0
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface text-text-muted md:flex">
      <SidebarContent />
    </aside>
  );
}
