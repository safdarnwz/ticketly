import { LogOut, Menu, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/stores/auth';
import { useIsAgent, useIsCrew } from '@/lib/useAgent';

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.user?.roles?.[0]);
  const logout = useAuth((s) => s.logout);
  const { isAgent } = useIsAgent();
  const { isCrew } = useIsCrew();
  // A name's initials; a login named by its phone number gets the person icon instead.
  const initials = (user?.fullName ?? '').split(/\s+/).filter((w) => /^[a-z]/i.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 bg-bg px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button type="button" onClick={onMenu} aria-label="Open menu" className="-ml-1 flex h-10 w-10 items-center justify-center rounded-xl text-text hover:bg-surface-muted md:hidden">
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="truncate text-sm font-semibold text-text-muted">
          {isAgent ? 'Agent portal' : isCrew ? 'Crew app' : user?.tenantId ? 'Operator console' : 'Platform console'}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <button type="button" disabled={!user?.tenantId} onClick={() => navigate('/me')} title={user?.tenantId ? 'My account' : undefined} className="flex items-center gap-2.5 rounded-pill bg-surface py-1 pl-1 pr-1 shadow-sm hover:shadow-md disabled:cursor-default sm:pr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-secondary text-xs font-bold text-white">
            {initials || <User className="h-4 w-4" />}
          </div>
          <div className="hidden text-left sm:block">
            <div className="text-sm font-semibold leading-tight text-text">{user?.fullName ?? 'User'}</div>
            <div className="text-[11px] capitalize text-text-muted">{role ?? 'member'}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => { logout(); navigate('/login'); }}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-10 items-center gap-2 rounded-pill bg-surface px-3 text-sm font-semibold text-text-muted shadow-sm hover:text-text"
        >
          <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
