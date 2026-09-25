/**
 * Plan + per-operator entitlements — pure, JSON-safe.
 *
 * - features: plan features overlaid with operator overrides; only an
 *   EXPLICIT false disables (no plan / unmentioned feature = allowed), so
 *   switching enforcement on never locks existing operators out;
 * - quotas: numeric plan limits only (null / missing = unlimited).
 * The result is plain arrays/objects because it is cached in Redis — a Set
 * would serialise to {} and crash on the way back.
 */
export interface Entitlements {
  features: string[];
  disabled: string[];
  quotas: Record<string, number>;
}

const on = (v: unknown) => v === true || v === 'true' || v === 1;

export function resolveEntitlements(
  planFeatures: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> | null | undefined,
  planQuotas: Record<string, unknown> | null | undefined,
): Entitlements {
  const features: string[] = [];
  const disabled: string[] = [];
  for (const [k, v] of Object.entries({ ...(planFeatures ?? {}), ...(overrides ?? {}) }))
    (on(v) ? features : disabled).push(k);
  const quotas: Record<string, number> = {};
  for (const [k, v] of Object.entries(planQuotas ?? {}))
    if (typeof v === 'number' && Number.isFinite(v)) quotas[k] = v;
  return { features, disabled, quotas };
}

export function isFeatureAllowed(e: { disabled: Iterable<string> }, feature: string): boolean {
  for (const d of e.disabled) if (d === feature) return false;
  return true;
}
