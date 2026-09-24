import type { UUID } from 'uuidv7';
import { uuidv7 as generateUuidV7, uuidv7obj } from 'uuidv7';

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
 *
 *  Each is a `Uuid` narrowed by kind, so `newId() as TripId` is a checked
 *  narrowing, a `TripId` is accepted anywhere a `Uuid` is, and a `TripId`
 *  is still NOT accepted where a `VehicleId` is expected.
 */
declare const __idKind: unique symbol;
export type TypedId<K extends string> = Uuid & { readonly [__idKind]: K };
export type TenantId = TypedId<'TenantId'>; // the SaaS customer (bus operator)
export type UserId = TypedId<'UserId'>;
export type RoleId = TypedId<'RoleId'>;
export type ApiKeyId = TypedId<'ApiKeyId'>;
export type SessionId = TypedId<'SessionId'>;

export type CountryId = TypedId<'CountryId'>;
export type StateId = TypedId<'StateId'>;
export type CityId = TypedId<'CityId'>;
export type StopId = TypedId<'StopId'>;
export type RouteId = TypedId<'RouteId'>;
export type RouteStopId = TypedId<'RouteStopId'>;
export type AmenityId = TypedId<'AmenityId'>;

export type VehicleId = TypedId<'VehicleId'>;
export type VehicleTypeId = TypedId<'VehicleTypeId'>;
export type SeatLayoutId = TypedId<'SeatLayoutId'>;
export type SeatId = TypedId<'SeatId'>;
export type CrewId = TypedId<'CrewId'>;
export type AgentId = TypedId<'AgentId'>;
export type BranchId = TypedId<'BranchId'>;
export type DutyId = TypedId<'DutyId'>;

export type ServiceId = TypedId<'ServiceId'>; // a recurring scheduled service
export type TripId = TypedId<'TripId'>; // one dated instance of a service
export type SegmentId = TypedId<'SegmentId'>;
export type InventoryHoldId = TypedId<'InventoryHoldId'>;

export type FareRuleId = TypedId<'FareRuleId'>;
export type FarePlanId = TypedId<'FarePlanId'>;
export type CouponId = TypedId<'CouponId'>;
export type PricingPolicyId = TypedId<'PricingPolicyId'>;

export type BookingId = TypedId<'BookingId'>;
export type TicketId = TypedId<'TicketId'>;
export type PassengerId = TypedId<'PassengerId'>;
export type CancellationId = TypedId<'CancellationId'>;

export type PaymentId = TypedId<'PaymentId'>;
export type RefundId = TypedId<'RefundId'>;
export type LedgerEntryId = TypedId<'LedgerEntryId'>;
export type SettlementId = TypedId<'SettlementId'>;
export type InvoiceId = TypedId<'InvoiceId'>;

export type DeviceId = TypedId<'DeviceId'>;
export type NotificationId = TypedId<'NotificationId'>;
export type OutboxId = TypedId<'OutboxId'>;
export type ChannelPartnerId = TypedId<'ChannelPartnerId'>; // OTA / GDS consumer

// Storefront (Part 14)
export type ReviewId = TypedId<'ReviewId'>;
export type SupportTicketId = TypedId<'SupportTicketId'>;
export type SupportMessageId = TypedId<'SupportMessageId'>;
export type OfferId = TypedId<'OfferId'>;
export type CmsPageId = TypedId<'CmsPageId'>;
export type BannerId = TypedId<'BannerId'>;
export type RiskAssessmentId = TypedId<'RiskAssessmentId'>;
