import { LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui';
import { useAuth } from '@/stores/auth';

export function Topbar() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const role = useAuth((s) => s.user?.roles?.[0]);
  const logout = useAuth((s) => s.logout);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="text-sm font-medium text-text-muted">
        {user?.tenantId ? 'Operator console' : 'Platform console'}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface-muted text-text-muted">
            <User className="h-4 w-4" />
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-text">{user?.fullName ?? 'User'}</div>
            <div className="text-xs capitalize text-text-muted">{role ?? 'member'}</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { logout(); navigate('/login'); }}
          leftIcon={<LogOut className="h-4 w-4" />}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
