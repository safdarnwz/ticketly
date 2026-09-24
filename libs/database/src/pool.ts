import { Pool, types, type PoolConfig, type PoolClient } from 'pg';

import type { AppConfig } from '@config';
import type { Logger, Metrics } from '@observability';

/**
 * ============================================================================
 *  Connection pooling
 * ============================================================================
 *
 * TYPE PARSER OVERRIDES (applied once, process-wide):
 *
 *  - `int8` (bigint, OID 20) → Number. Our bigints are money in minor units and
 *    row counts; both are far below 2^53. Default node-postgres returns a
 *    *string*, which silently turns `total + fare` into string concatenation.
 *    A guard throws if a value ever does exceed the safe range.
 *  - `numeric` (OID 1700) → Number. We avoid numeric for money (see Money) and
 *    only use it for ratios/distances where float64 is fine.
 *  - `date` (OID 1082) → string. A journey date must stay `YYYY-MM-DD`; letting
 *    pg build a JS Date shifts it by the server's timezone offset — the single
 *    most common "customer sees the wrong day" bug in ticketing.
 *  - `timestamptz` stays a Date (correct: it is an absolute instant).
 *  - `timestamp` (no tz, OID 1114) → string. If it has no zone, we refuse to
 *    guess one.
 *
 * SESSION SETTINGS are applied on every new connection so no query can hold a
 * lock or burn CPU indefinitely, even if a developer forgets a WHERE clause.
 */

let parsersInstalled = false;

function installTypeParsers(): void {
  if (parsersInstalled) return;
  parsersInstalled = true;

  types.setTypeParser(types.builtins.INT8, (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`bigint ${value} exceeds Number.MAX_SAFE_INTEGER; read it as text instead`);
    }
    return n;
  });
  types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number(value));
  types.setTypeParser(types.builtins.DATE, (value: string) => value);
  types.setTypeParser(types.builtins.TIMESTAMP, (value: string) => value);
  // int4/int2 arrays and uuid[] are handled correctly by default.
}

export type PoolRole = 'primary' | 'replica';

export interface NamedPool {
  name: string;
  role: PoolRole;
  pool: Pool;
}

export function createPool(
  config: AppConfig,
  options: { name: string; role: PoolRole; host: string; port: number; logger: Logger },
): NamedPool {
  installTypeParsers();
  const { db } = config;

  const poolConfig: PoolConfig = {
    host: options.host,
    port: options.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl ? { rejectUnauthorized: db.sslRejectUnauthorized } : undefined,

    min: options.role === 'primary' ? db.poolMin : 0,
    max: options.role === 'primary' ? db.poolMax : db.replicaPoolMax,
    idleTimeoutMillis: db.idleTimeoutMs,
    connectionTimeoutMillis: db.connectionTimeoutMs,
    maxUses: db.maxUsesPerConnection > 0 ? db.maxUsesPerConnection : undefined,
    allowExitOnIdle: false,

    // `application_name` shows up in pg_stat_activity — indispensable when you
    // need to know WHICH service is holding the lock at 9pm.
    application_name: `${db.applicationName}:${options.role}:${config.app.instanceId}`,

    // Applied by Postgres at connection time; cheaper than an extra round trip.
    options: buildStartupOptions(config, options.role),
  };

  const pool = new Pool(poolConfig);

  pool.on('error', (error) => {
    // Emitted for IDLE clients. Never let this become an unhandled 'error'
    // event — that crashes the process on a routine network blip.
    options.logger.error(error, 'Idle database client error', { pool: options.name });
  });

  pool.on('connect', (client: PoolClient) => {
    options.logger.debug({ pool: options.name }, 'database connection established');
    client.on('notice', (notice) => {
      options.logger.debug({ pool: options.name, notice: notice.message }, 'postgres notice');
    });
  });

  return { name: options.name, role: options.role, pool };
}

function buildStartupOptions(config: AppConfig, role: PoolRole): string {
  const { db } = config;
  const settings = [
    `-c search_path=${db.schema},public`,
    `-c statement_timeout=${db.statementTimeoutMs}`,
    `-c lock_timeout=${db.lockTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${db.idleInTransactionTimeoutMs}`,
    // Bounds the cost of a bad plan on a rarely-hit query path.
    `-c jit=off`,
    // Timestamps are always exchanged in UTC; conversion happens in the app
    // using the *stop's* timezone, never the server's.
    `-c timezone=UTC`,
  ];
  if (role === 'replica') {
    // Belt and braces: even if routing has a bug, a write here fails loudly.
    settings.push('-c default_transaction_read_only=on');
  }
  return settings.join(' ');
}

/** Publish pool saturation to Prometheus. Waiting > 0 sustained = pool too small. */
export function observePool(pools: NamedPool[], metrics: Metrics): void {
  for (const { name, pool } of pools) {
    metrics.dbPoolTotal.set({ pool: name }, pool.totalCount);
    metrics.dbPoolIdle.set({ pool: name }, pool.idleCount);
    metrics.dbPoolWaiting.set({ pool: name }, pool.waitingCount);
  }
}
