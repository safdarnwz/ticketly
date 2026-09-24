import type { PoolClient } from 'pg';

import type { TenantId } from '@kernel';

/**
 * ============================================================================
 *  Row-Level Security session binding
 * ============================================================================
 *
 * Every tenant-scoped table carries an RLS policy of the form:
 *
 *   CREATE POLICY tenant_isolation ON bookings
 *     USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
 *
 * For that to work, the *connection* must know which tenant it is serving. This
 * module owns that binding.
 *
 * DESIGN NOTE — why not `SET LOCAL` inside a transaction every time?
 * `SET LOCAL` is the textbook answer and we DO use it inside transactions
 * (see `unit-of-work.ts`). But most read traffic is a single statement, and
 * wrapping every single-statement read in BEGIN/COMMIT costs two extra network
 * round trips — at our latency budget (search p99 < 120ms with ~8 queries) that
 * is unacceptable.
 *
 * Instead, for non-transactional work we set the GUC at connection *checkout*
 * and memoise the value on the client object. Because a pooled client is held
 * exclusively for the duration of a lease, this is safe, and because consecutive
 * requests from the same tenant tend to land on the same warm connections, the
 * extra round trip is skipped the overwhelming majority of the time.
 *
 * On release we deliberately do NOT reset the GUC — resetting would cost a
 * round trip on every release and gain nothing, since the next lease either
 * re-uses the same tenant (no-op) or overwrites it (checked below).
 *
 * SAFETY: the GUC is *never* the only defence. Repositories still emit an
 * explicit `tenant_id = $1` predicate (which is also what makes the composite
 * indexes usable). RLS is the net that catches the query someone forgets.
 */

const BOUND_TENANT = Symbol('boundTenantId');

type TaggedClient = PoolClient & { [BOUND_TENANT]?: string | null };

/** Bind (or rebind) the connection's tenant GUC. No-op when unchanged. */
export async function bindTenant(client: PoolClient, tenantId: TenantId | null): Promise<void> {
  const tagged = client as TaggedClient;
  const desired = tenantId ?? '';
  if (tagged[BOUND_TENANT] === desired) return;

  // `false` = session-scoped (survives until the connection is rebound).
  // Inside a transaction, `unit-of-work.ts` uses the transaction-scoped form.
  await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', desired]);
  tagged[BOUND_TENANT] = desired;
}

/** Transaction-scoped binding — reverted automatically at COMMIT/ROLLBACK. */
export async function bindTenantLocal(
  client: PoolClient,
  tenantId: TenantId | null,
): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
  // The session-level memo is now stale for this client; forget it so the next
  // non-transactional lease re-binds explicitly.
  (client as TaggedClient)[BOUND_TENANT] = undefined;
}

/**
 * Elevate to a role that bypasses RLS, for platform-admin and migration work.
 * Every call is audited by the caller (Part 2). Transaction-scoped only.
 */
export async function bypassRlsLocal(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
}

export function boundTenantOf(client: PoolClient): string | null | undefined {
  return (client as TaggedClient)[BOUND_TENANT];
}
