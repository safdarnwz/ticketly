import { LogOut, Menu, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useIsAgent, useIsCrew } from '@/lib/useAgent';

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.user?.roles?.[0]);
  const logout = useAuth((s) => s.logout);
  const { isAgent } = useIsAgent();
  const { isCrew } = useIsCrew();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Phones: the menu lives in a drawer (the sidebar is hidden below md). */}
        {onMenu && (
          <button type="button" onClick={onMenu} aria-label="Open menu" className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-text hover:bg-surface-muted md:hidden">
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="truncate text-sm font-medium text-text-muted">
          {isAgent ? 'Agent portal' : isCrew ? 'Crew app' : user?.tenantId ? 'Operator console' : 'Platform console'}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <button type="button" disabled={!user?.tenantId} onClick={() => navigate('/me')} title={user?.tenantId ? 'My account' : undefined} aria-label="My account" className="flex items-center gap-2.5 rounded-md px-1 hover:bg-surface-muted">
          <div className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface-muted text-text-muted">
            <User className="h-4 w-4" />
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-text">{user?.fullName ?? 'User'}</div>
            <div className="text-xs capitalize text-text-muted">{role ?? 'member'}</div>
          </div>
        </button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 px-2.5 sm:px-3.5"
          onClick={() => { logout(); navigate('/login'); }}
          leftIcon={<LogOut className="h-4 w-4" />}
          aria-label="Sign out"
        >
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
