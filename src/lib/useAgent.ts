import { useQuery } from '@tanstack/react-query';

import { authApi } from '@/lib/api/auth';
import { isSuperAdmin } from '@/lib/host';

/**
 * A travel agent's login: it carries the operator's 'agent' role (given when
 * the agent is onboarded) and no staff role. An admin's permission list may
 * include the agent-portal permission too — that does not make them an agent.
 */
export function useIsAgent(): { isAgent: boolean; loading: boolean } {
  const me = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me, enabled: !isSuperAdmin, staleTime: 60_000 });
  const roles = me.data?.roles ?? [];
  return { isAgent: roles.includes('agent') && roles.length === 1, loading: me.isLoading };
}

/** A conductor / driver login: the operator's 'crew' role only — they use the crew app. */
export function useIsCrew(): { isCrew: boolean; loading: boolean } {
  const me = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me, enabled: !isSuperAdmin, staleTime: 60_000 });
  const roles = me.data?.roles ?? [];
  return { isCrew: roles.length === 1 && roles[0] === 'crew', loading: me.isLoading };
}
