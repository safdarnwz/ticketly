import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { configureApiAuth } from '@/lib/api/client';
import { authApi } from '@/lib/api/auth';
import { SURFACE_TENANT_SLUG } from '@/lib/host';
import type { AuthUser } from '@/lib/api/types';

interface JwtClaims { sub?: string; roles?: string[]; tenant?: string; tid?: string; email?: string; name?: string; exp?: number }

function decodeJwt(token: string): JwtClaims {
  try {
    const json = atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json))) as JwtClaims;
  } catch {
    return {};
  }
}

function userFromToken(token: string, fallbackIdentifier?: string): AuthUser {
  const c = decodeJwt(token);
  return {
    id: c.sub ?? '',
    email: c.email ?? (fallbackIdentifier?.includes('@') ? fallbackIdentifier : null),
    fullName: c.name ?? (fallbackIdentifier ?? 'User'),
    tenantId: c.tid ?? c.tenant ?? null,
    roles: c.roles ?? [],
    permissions: [],
  };
}

/** The canonical role → determines post-login destination. */
export function homeForRoles(roles: string[], surface?: string): string {
  if (roles.includes('super_admin') || roles.includes('platform_admin')) return '/admin/tenants';
  if (roles.includes('agent')) return '/agent';
  // On an operator's console every signed-in user is staff (custom role names included).
  if (surface === 'tenantAdmin') return '/dashboard';
  if (roles.includes('operator_admin') || roles.includes('operator_staff')
    || roles.some((r) => ['owner', 'manager', 'finance', 'ops', 'support'].includes(r))) return '/dashboard';
  return '/account'; // customer
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  tenantSlug: string | null;
  user: AuthUser | null;
  status: 'idle' | 'authenticating';
  login: (identifier: string, password: string) => Promise<AuthUser>;
  setSession: (tokens: { accessToken: string; refreshToken: string }, identifier?: string) => AuthUser;
  logout: () => void;
  primaryRole: () => string | undefined;
  isCustomer: () => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, gettr) => ({
      token: null, refreshToken: null, tenantSlug: null, user: null, status: 'idle',

      login: async (identifier, password) => {
        set({ status: 'authenticating' });
        try {
          const res = await authApi.login(identifier, password);
          const user = userFromToken(res.accessToken, identifier);
          set({ token: res.accessToken, refreshToken: res.refreshToken, user, status: 'idle' });
          return user;
        } catch (e) {
          set({ status: 'idle' });
          throw e;
        }
      },

      setSession: (tokens, identifier) => {
        const user = userFromToken(tokens.accessToken, identifier);
        set({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user });
        return user;
      },

      logout: () => {
        const rt = gettr().refreshToken;
        if (rt) void authApi.logout(rt).catch(() => undefined);
        set({ token: null, refreshToken: null, user: null });
      },

      primaryRole: () => gettr().user?.roles?.[0],
      isCustomer: () => {
        const roles = gettr().user?.roles ?? [];
        return roles.length === 0 || roles.includes('customer');
      },
    }),
    { name: 'ticketly.auth' },
  ),
);

configureApiAuth({
  getToken: () => useAuth.getState().token,
  // In production the real Host header (app.<slug>.ticketly.com) is what the
  // backend actually resolves the tenant from — this is only a fallback for
  // local dev, where `?surface=tenantAdmin&tenant=<slug>` stands in for a
  // subdomain the dev server can't have.
  getTenant: () => useAuth.getState().tenantSlug ?? SURFACE_TENANT_SLUG,
  onUnauthorized: () => {
    if (useAuth.getState().token) useAuth.setState({ token: null, refreshToken: null, user: null });
  },
});
