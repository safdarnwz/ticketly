import { uuidv7 as generateUuidV7, uuidv7obj, UUID } from 'uuidv7';

import type { Brand } from './types';

/**
 * ============================================================================
 *  UUID v7 — the platform's one and only identifier strategy
 * ============================================================================
 *
 * WHY v7 AND NOT v4 / bigserial:
 *
 *  1. **Index locality.** v7 embeds a 48-bit big-endian Unix millisecond
 *     timestamp in the high bits, so newly generated ids sort monotonically.
 *     Inserts land on the right-hand edge of the B-tree instead of scattering
 *     across every leaf page like v4 does. On a 100M-row `bookings` table this
 *     is the difference between a ~15% and a ~90% buffer cache hit rate on
 *     insert, and it keeps index bloat near zero.
 *
 *  2. **No coordination.** Unlike `bigserial` there is no sequence round-trip,
 *     so ids can be minted in the application *before* the INSERT. That is what
 *     makes the outbox pattern, idempotent retries and multi-table sagas in
 *     Part 7/8 possible: we know the booking id before the transaction opens.
 *
 *  3. **Not guessable, not enumerable.** A `bigserial` PNR-adjacent id leaks
 *     business volume to competitors and enables scraping. v7's 74 random bits
 *     make enumeration infeasible.
 *
 *  4. **Free created-at.** `uuidTimestamp(id)` recovers the creation instant
 *     without a column read — handy for cheap time-range pruning and debugging.
 *
 * STORAGE: always `uuid` (16 bytes) in Postgres, never `text`/`varchar(36)`.
 * Text costs 37 bytes, breaks index-only scans and makes every comparison a
 * string compare.
 *
 * ORDERING: `ORDER BY id DESC` is a valid, index-backed substitute for
 * `ORDER BY created_at DESC, id DESC` for single-node inserts. We still keep
 * `created_at` for business semantics (back-dated imports), but keyset
 * pagination in `pagination.ts` uses the id.
 */

/** A raw UUID string in canonical lowercase 8-4-4-4-12 form. */
export type Uuid = Brand<string, 'Uuid'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000' as Uuid;

/** Generate a new UUID v7. Monotonic within the process even at >1M/sec. */
export function newId(): Uuid {
  return generateUuidV7() as Uuid;
}

/**
 * Generate a typed id. Prefer this at call sites so the branded type is
 * inferred: `const id = newTypedId<TripId>()`.
 */
export function newTypedId<T extends Uuid>(): T {
  return generateUuidV7() as T;
}

/** Generate `count` monotonically increasing ids — for bulk inserts. */
export function newIds(count: number): Uuid[] {
  const out = new Array<Uuid>(count);
  for (let i = 0; i < count; i += 1) out[i] = generateUuidV7() as Uuid;
  return out;
}

/** True when the value is a syntactically valid canonical UUID. */
export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** True when the value is a valid UUID whose version nibble is 7. */
export function isUuidV7(value: unknown): value is Uuid {
  return isUuid(value) && value.charAt(14) === '7';
}

/** Normalise user input (trim + lowercase) and validate. Returns null if bad. */
export function parseUuid(value: unknown): Uuid | null {
  if (typeof value !== 'string') return null;
  const normalised = value.trim().toLowerCase();
  return UUID_RE.test(normalised) ? (normalised as Uuid) : null;
}

/**
 * Extract the creation timestamp embedded in a UUID v7.
 * Returns `null` for non-v7 uuids.
 */
export function uuidTimestamp(value: Uuid): Date | null {
  if (!isUuidV7(value)) return null;
  const hex = value.slice(0, 8) + value.slice(9, 13);
  return new Date(Number.parseInt(hex, 16));
}

/**
 * Build the smallest possible UUID v7 for a given instant. Useful for
 * time-bounded keyset scans:
 *   `WHERE id >= $lowerBound AND id < $upperBound`
 * which is an index range scan on the PK — no `created_at` index required.
 */
export function uuidV7LowerBound(at: Date): Uuid {
  const ms = BigInt(at.getTime());
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000` as Uuid;
}

/** Build the largest possible UUID v7 for a given instant (exclusive upper). */
export function uuidV7UpperBound(at: Date): Uuid {
  const ms = BigInt(at.getTime());
  const hex = ms.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7fff-bfff-ffffffffffff` as Uuid;
}

/** The all-zero UUID. Used as the "system actor" in audit rows. */
export function nilUuid(): Uuid {
  return NIL_UUID;
}

/** Compare two uuids lexicographically (matches Postgres `uuid` ordering). */
export function compareUuid(a: Uuid, b: Uuid): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Escape hatch to the underlying library object (bytes, ints, etc.). */
export function uuidObject(): UUID {
  return uuidv7obj();
}

/**
 * ---------------------------------------------------------------------------
 *  Branded id types used across the platform.
 * ---------------------------------------------------------------------------
 *  Every bounded context re-exports the ids it owns; they are declared here so
 *  cross-context references (a `Trip` holding a `RouteId`) never create a
 *  module cycle. Adding a new aggregate = adding one line here.
 */
export type TenantId = Brand<string, 'TenantId'>; // the SaaS customer (bus operator)
export type UserId = Brand<string, 'UserId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type SessionId = Brand<string, 'SessionId'>;

export type CountryId = Brand<string, 'CountryId'>;
export type StateId = Brand<string, 'StateId'>;
export type CityId = Brand<string, 'CityId'>;
export type StopId = Brand<string, 'StopId'>;
export type RouteId = Brand<string, 'RouteId'>;
export type RouteStopId = Brand<string, 'RouteStopId'>;
export type AmenityId = Brand<string, 'AmenityId'>;

export type VehicleId = Brand<string, 'VehicleId'>;
export type VehicleTypeId = Brand<string, 'VehicleTypeId'>;
export type SeatLayoutId = Brand<string, 'SeatLayoutId'>;
export type SeatId = Brand<string, 'SeatId'>;
export type CrewId = Brand<string, 'CrewId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type BranchId = Brand<string, 'BranchId'>;
export type DutyId = Brand<string, 'DutyId'>;

export type ServiceId = Brand<string, 'ServiceId'>; // a recurring scheduled service
export type TripId = Brand<string, 'TripId'>; // one dated instance of a service
export type SegmentId = Brand<string, 'SegmentId'>;
export type InventoryHoldId = Brand<string, 'InventoryHoldId'>;

export type FareRuleId = Brand<string, 'FareRuleId'>;
export type FarePlanId = Brand<string, 'FarePlanId'>;
export type CouponId = Brand<string, 'CouponId'>;
export type PricingPolicyId = Brand<string, 'PricingPolicyId'>;

export type BookingId = Brand<string, 'BookingId'>;
export type TicketId = Brand<string, 'TicketId'>;
export type PassengerId = Brand<string, 'PassengerId'>;
export type CancellationId = Brand<string, 'CancellationId'>;

export type PaymentId = Brand<string, 'PaymentId'>;
export type RefundId = Brand<string, 'RefundId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type SettlementId = Brand<string, 'SettlementId'>;
export type InvoiceId = Brand<string, 'InvoiceId'>;

export type DeviceId = Brand<string, 'DeviceId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type OutboxId = Brand<string, 'OutboxId'>;
export type ChannelPartnerId = Brand<string, 'ChannelPartnerId'>; // OTA / GDS consumer

// Storefront (Part 14)
export type ReviewId = Brand<string, 'ReviewId'>;
export type SupportTicketId = Brand<string, 'SupportTicketId'>;
export type SupportMessageId = Brand<string, 'SupportMessageId'>;
export type OfferId = Brand<string, 'OfferId'>;
export type CmsPageId = Brand<string, 'CmsPageId'>;
export type BannerId = Brand<string, 'BannerId'>;
export type RiskAssessmentId = Brand<string, 'RiskAssessmentId'>;
