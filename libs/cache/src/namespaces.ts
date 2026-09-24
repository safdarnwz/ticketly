/**
 * Cache namespaces and their TTLs, declared in one place.
 *
 * Having every TTL visible together is what stops the classic drift where one
 * developer caches routes for 5 minutes and another caches the stops those
 * routes point at for an hour — producing a UI that shows a stop that no longer
 * exists on the route.
 *
 * TTL RATIONALE
 *  - master data: changes a few times a week, read on every search → long TTL,
 *    explicit invalidation on write.
 *  - tenant config / feature flags: read on every request → short TTL so a plan
 *    change takes effect quickly without a deploy.
 *  - search results: seconds only. Availability moves constantly; a stale
 *    search card that says "4 seats" when there is 1 is a support ticket.
 *  - never cached: seat locks, payment state, ledger balances.
 */
export const CacheNamespace = {
  TENANT: 'tenant',
  TENANT_FEATURES: 'tenant:features',
  USER_PERMISSIONS: 'user:perm',
  GEO: 'geo',
  STOP: 'stop',
  ROUTE: 'route',
  SEAT_LAYOUT: 'layout',
  VEHICLE_TYPE: 'vtype',
  AMENITY: 'amenity',
  SERVICE: 'service',
  TRIP_SUMMARY: 'trip',
  SEARCH: 'search',
  FARE_RULE: 'fare',
  PRICING_POLICY: 'pricing',
  COUPON: 'coupon',
  IDEMPOTENCY: 'idem',
  RATE_LIMIT: 'rl',
} as const;

export const CacheTtl = {
  MASTER_DATA: 3_600,
  TENANT_CONFIG: 60,
  PERMISSIONS: 120,
  SEARCH_RESULTS: 15,
  TRIP_SUMMARY: 30,
  FARE_RULES: 300,
  IDEMPOTENCY: 86_400,
} as const;
