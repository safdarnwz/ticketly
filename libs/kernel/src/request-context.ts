import { AsyncLocalStorage } from 'node:async_hooks';

import { InternalError } from './errors';
import { newId, type TenantId, type UserId, type Uuid } from './ids';
import type { UnknownRecord } from './types';

/**
 * ============================================================================
 *  Ambient request context (AsyncLocalStorage)
 * ============================================================================
 *
 * WHY: in a multi-tenant system, `tenantId` is needed by *every* repository,
 * *every* cache key, *every* log line and *every* metric. Threading it through
 * 6 layers of function signatures is noise, and — far worse — the one place a
 * developer forgets to pass it becomes a cross-tenant data leak.
 *
 * So it lives in an ALS store established once, at the edge, by
 * `RequestContextMiddleware` (libs/http). Everything downstream reads it.
 *
 * INVARIANTS
 *  - The store is **immutable per request** except for the fields explicitly
 *    designed to be set later (`userId` after auth, `tx` inside a UoW).
 *  - Repositories call `requireTenantId()`, which throws rather than silently
 *    querying across tenants. Combined with Postgres RLS (Part 2) this is a
 *    belt-and-braces defence: application bug OR missing WHERE clause still
 *    cannot leak another operator's bookings.
 *  - Background jobs and the outbox worker MUST call `runWithContext()`
 *    explicitly with the tenant they are acting for. There is no implicit
 *    "no tenant" mode outside of platform-admin operations.
 */

export type ActorType = 'user' | 'api_key' | 'channel_partner' | 'system' | 'anonymous';

export interface RequestContext {
  /** Unique per request/job execution. Emitted in every log line. */
  readonly requestId: Uuid;
  /** Propagated from the caller (`x-correlation-id`) or seeded from requestId. */
  readonly correlationId: string;
  /** W3C trace id when tracing is enabled — links logs to spans. */
  readonly traceId?: string;

  /** Resolved bus operator. Undefined only for platform-admin / public routes. */
  tenantId?: TenantId;
  /** Authenticated principal. */
  userId?: UserId;
  actorType: ActorType;
  /** Flattened permission strings, e.g. `booking:cancel`. */
  permissions: ReadonlySet<string>;
  /** Feature flags resolved for this tenant's plan. */
  features: ReadonlySet<string>;

  readonly ip?: string;
  readonly userAgent?: string;
  readonly route?: string;
  readonly method?: string;
  readonly startedAt: number;

  /** Idempotency key supplied by the caller, if any. */
  idempotencyKey?: string;
  /** Active database transaction (set by the unit of work). */
  tx?: unknown;
  /** Free-form values attached by middleware; included in logs. */
  readonly extra: UnknownRecord;
}

const storage = new AsyncLocalStorage<RequestContext>();

export interface CreateContextInput extends Partial<
  Omit<RequestContext, 'permissions' | 'features' | 'extra'>
> {
  permissions?: Iterable<string>;
  features?: Iterable<string>;
  extra?: UnknownRecord;
}

export function createContext(input: CreateContextInput = {}): RequestContext {
  const requestId = input.requestId ?? newId();
  return {
    requestId,
    correlationId: input.correlationId ?? requestId,
    traceId: input.traceId,
    tenantId: input.tenantId,
    userId: input.userId,
    actorType: input.actorType ?? 'anonymous',
    permissions: new Set(input.permissions ?? []),
    features: new Set(input.features ?? []),
    ip: input.ip,
    userAgent: input.userAgent,
    route: input.route,
    method: input.method,
    startedAt: input.startedAt ?? Date.now(),
    idempotencyKey: input.idempotencyKey,
    tx: input.tx,
    extra: input.extra ?? {},
  };
}

/** Run `fn` with the given context bound to the async execution path. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Convenience for jobs: build a context and run in one call. */
export function runInNewContext<T>(input: CreateContextInput, fn: () => T): T {
  return storage.run(createContext(input), fn);
}

/** Current context, or undefined outside any request/job. */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Current context; throws if called outside a context. */
export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new InternalError('No request context bound. Wrap background work in runInNewContext().');
  }
  return ctx;
}

/**
 * The tenant every repository must scope to. Throwing here — rather than
 * returning undefined — is the single most valuable safety property of this
 * module.
 */
export function requireTenantId(): TenantId {
  const ctx = requireContext();
  if (!ctx.tenantId) {
    throw new InternalError('Tenant scope required but no tenant is bound to this context');
  }
  return ctx.tenantId;
}

export function getTenantId(): TenantId | undefined {
  return storage.getStore()?.tenantId;
}

export function getUserId(): UserId | undefined {
  return storage.getStore()?.userId;
}

export function getRequestId(): Uuid | undefined {
  return storage.getStore()?.requestId;
}

export function hasPermission(permission: string): boolean {
  const ctx = storage.getStore();
  if (!ctx) return false;
  return ctx.permissions.has('*') || ctx.permissions.has(permission);
}

export function hasFeature(feature: string): boolean {
  return storage.getStore()?.features.has(feature) ?? false;
}

/** Elapsed milliseconds since the context was created. */
export function elapsedMs(): number {
  const ctx = storage.getStore();
  return ctx ? Date.now() - ctx.startedAt : 0;
}

/** The subset of context that is safe and useful to attach to every log line. */
export function contextLogFields(): UnknownRecord {
  const ctx = storage.getStore();
  if (!ctx) return {};
  return {
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    actorType: ctx.actorType,
  };
}

/**
 * Escape hatch: run `fn` with the ambient context temporarily replaced.
 * Used by the platform-admin console to act on behalf of a tenant, and by
 * tests. Every use is audited (Part 2).
 */
export function runAsTenant<T>(tenantId: TenantId, fn: () => T): T {
  const current = requireContext();
  return storage.run({ ...current, tenantId }, fn);
}
