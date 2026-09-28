/**
 * Which surface is this? The SAME frontend build serves all three Ticketly
 * hosts, matching the backend's `TenantResolutionMiddleware`:
 *   - www.ticketly.com (+ apex)   → customer storefront, no login to browse
 *   - app.ticketly.com            → super/platform admin console
 *   - app.<slug>.ticketly.com     → one operator's staff console
 *
 * Detected from the hostname. `.localhost` is handled as its own case (see
 * below) so the REAL subdomain pattern — `app.<slug>.localhost` — works for
 * local dev too, not just the `?surface=`/`?tenant=` query-param override
 * (which still exists below, for whenever `/etc/hosts` isn't set up).
 */
export type Surface = 'customer' | 'superAdmin' | 'tenantAdmin';

export interface SurfaceInfo {
  surface: Surface;
  /** The operator slug, only set when `surface === 'tenantAdmin'`. */
  tenantSlug: string | null;
}

function fromHost(host: string): SurfaceInfo {
  if (!host.startsWith('app.')) return { surface: 'customer', tenantSlug: null };

  const labels = host.split('.');

  // `.localhost` is a SINGLE label (RFC 6761) — there is no real 2-label
  // "domain.tld" underneath it the way `ticketly.com` has one in
  // production, so its label-count for the SAME two surfaces is exactly
  // one less: "app.localhost" (2 labels) = super-admin, matching
  // "app.ticketly.com" (3 labels) in production; "app.<slug>.localhost"
  // (3 labels) = tenant console, matching "app.<slug>.ticketly.com" (4
  // labels) in production. Handling this as its own branch — rather than
  // trying to make one threshold cover both — is what actually lets the
  // REAL subdomain URL (not just the query-param override) work locally.
  const isLocalhostTld = labels[labels.length - 1] === 'localhost';
  const tenantThreshold = isLocalhostTld ? 3 : 4;

  if (labels.length >= tenantThreshold) {
    return { surface: 'tenantAdmin', tenantSlug: labels[1] };
  }
  return { surface: 'superAdmin', tenantSlug: null };
}

export function currentSurfaceInfo(): SurfaceInfo {
  if (typeof window === 'undefined') return { surface: 'customer', tenantSlug: null };

  const params = new URLSearchParams(window.location.search);
  const override = params.get('surface');
  if (override === 'customer' || override === 'superAdmin') {
    return { surface: override, tenantSlug: null };
  }
  if (override === 'tenantAdmin') {
    return { surface: 'tenantAdmin', tenantSlug: params.get('tenant') ?? 'demo' };
  }

  return fromHost(window.location.hostname);
}

export const { surface: SURFACE, tenantSlug: SURFACE_TENANT_SLUG } = currentSurfaceInfo();
export const isSuperAdmin = SURFACE === 'superAdmin';
export const isTenantAdmin = SURFACE === 'tenantAdmin';
export const isCustomer = SURFACE === 'customer';
/** True for either staff console (kept for call sites that don't care which). */
export const isPlatform = isSuperAdmin || isTenantAdmin;
