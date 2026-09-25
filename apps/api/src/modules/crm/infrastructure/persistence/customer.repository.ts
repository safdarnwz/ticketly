import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { requireTenantId, type UserId } from '@kernel';

registerConstraintMessages({
  customer_blocks_account: 'This customer is already blocked',
  customer_blocks_phone_uq: 'This mobile number is already blocked',
});

/** Frequent traveller: 5+ trips taken with the operator. */
export const FREQUENT_TRAVELLER_TRIPS = 5;

/** The last 10 digits of a mobile, however it was typed. */
export function mobileKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Who a customer is to an operator: their platform account if they booked
 * signed in, otherwise the mobile they booked with.
 */
export type CustomerKey = { customerId: string } | { phone: string };

export interface CustomerSummary {
  key: string;
  customerId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  bookings: number;
  trips: number;
  cancelled: number;
  spentMinor: number;
  firstBookedAt: string;
  lastBookedAt: string;
  lastJourneyDate: string | null;
  frequent: boolean;
  blocked: boolean;
}

export interface CustomerBlock {
  id: string;
  reason: string;
  blockedAt: string;
  blockedByName: string | null;
}

/**
 * An operator's customers, derived from its own bookings — customers hold
 * one platform-wide account, so there is no per-operator customer row. The
 * account's own profile (encrypted phone / email) is never read here: what
 * the operator sees is what was given on its bookings.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Per-booking rows keyed by customer; shared by the list and the profile. */
  private readonly keyed = `
    SELECT b.*, coalesce(b.customer_id::text, right(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g'), 10)) AS ckey,
           right(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g'), 10) AS mobile,
           (SELECT p.full_name FROM passengers p WHERE p.booking_id = b.id ORDER BY p.created_at, p.id LIMIT 1) AS lead_name,
           t.journey_date
      FROM bookings b LEFT JOIN trips t ON t.id = b.trip_id
     WHERE b.tenant_id = $1 AND b.status NOT IN ('held', 'expired')
       AND (b.customer_id IS NOT NULL OR length(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g')) >= 10)`;

  private readonly aggregate = `
    SELECT k.ckey AS key, (array_agg(k.customer_id))[1] AS "customerId",
           coalesce(max(u.full_name), (array_agg(k.lead_name ORDER BY k.created_at DESC))[1]) AS name,
           (array_agg(k.mobile ORDER BY k.created_at DESC))[1] AS phone,
           (array_agg(k.contact_email ORDER BY k.created_at DESC) FILTER (WHERE k.contact_email IS NOT NULL))[1] AS email,
           count(*)::int AS bookings,
           count(*) FILTER (WHERE k.status IN ('confirmed', 'completed'))::int AS trips,
           count(*) FILTER (WHERE k.status = 'cancelled')::int AS cancelled,
           coalesce(sum(k.paid_minor) FILTER (WHERE k.status IN ('confirmed', 'completed')), 0)::float8 AS "spentMinor",
           min(k.created_at) AS "firstBookedAt", max(k.created_at) AS "lastBookedAt",
           max(k.journey_date)::text AS "lastJourneyDate",
           EXISTS (SELECT 1 FROM customer_blocks cb WHERE cb.tenant_id = $1
                     AND (cb.customer_id::text = k.ckey OR cb.phone = ANY(array_agg(k.mobile)))) AS blocked
      FROM keyed k LEFT JOIN users u ON u.id = k.customer_id
     GROUP BY k.ckey`;

  async list(input: {
    q?: string;
    filter: 'all' | 'frequent' | 'blocked';
    offset: number;
    limit: number;
  }): Promise<CustomerSummary[]> {
    const q = input.q?.trim() ?? '';
    const digits = q.replace(/\D/g, '');
    const rows = await this.db.query<CustomerSummary>(
      `WITH keyed AS (${this.keyed}),
            agg AS (${this.aggregate})
       SELECT * FROM agg
        WHERE ($2::text = '' OR name ILIKE '%' || $2 || '%' OR lower(email) = lower($2)
               OR ($3::text <> '' AND length($3) >= 4 AND phone LIKE '%' || $3 || '%')
               OR key IN (SELECT ckey FROM keyed WHERE pnr = upper($2)))
          AND ($4::text <> 'frequent' OR trips >= ${FREQUENT_TRAVELLER_TRIPS})
          AND ($4::text <> 'blocked' OR blocked)
        ORDER BY "lastBookedAt" DESC, key
        OFFSET $5 LIMIT $6`,
      [requireTenantId(), q, digits, input.filter, input.offset, input.limit],
      { name: 'customer.list' },
    );
    return rows.map((r) => ({ ...r, frequent: r.trips >= FREQUENT_TRAVELLER_TRIPS }));
  }

  /** One customer of this operator; null when they never booked with it. */
  async profile(key: CustomerKey): Promise<CustomerSummary | null> {
    const ckey = 'customerId' in key ? key.customerId : key.phone;
    const rows = await this.db.query<CustomerSummary>(
      `WITH keyed AS (${this.keyed}),
            agg AS (${this.aggregate})
       SELECT * FROM agg WHERE key = $2`,
      [requireTenantId(), ckey],
      { name: 'customer.profile' },
    );
    const r = rows[0];
    return r ? { ...r, frequent: r.trips >= FREQUENT_TRAVELLER_TRIPS } : null;
  }

  async bookingHistory(key: CustomerKey, limit = 100): Promise<unknown[]> {
    const ckey = 'customerId' in key ? key.customerId : key.phone;
    return this.db.query(
      `WITH keyed AS (${this.keyed})
       SELECT k.id, k.pnr, k.status, k.seat_count AS "seatCount", k.total_minor::float8 AS "totalMinor",
              k.paid_minor::float8 AS "paidMinor", k.journey_date::text AS "journeyDate", r.name AS "routeName",
              k.channel, k.created_at AS "createdAt"
         FROM keyed k LEFT JOIN routes r ON r.id = k.route_id
        WHERE k.ckey = $2
        ORDER BY k.created_at DESC LIMIT $3`,
      [requireTenantId(), ckey, Math.min(limit, 200)],
      { name: 'customer.bookingHistory' },
    );
  }

  async blockFor(key: CustomerKey): Promise<CustomerBlock | null> {
    return this.db.queryOne<CustomerBlock>(
      `SELECT cb.id, cb.reason, cb.created_at AS "blockedAt", u.full_name AS "blockedByName"
         FROM customer_blocks cb LEFT JOIN users u ON u.id = cb.blocked_by
        WHERE cb.tenant_id = $1 AND (cb.customer_id::text = $2 OR cb.phone = $2 OR cb.phone = $3)
        ORDER BY cb.created_at LIMIT 1`,
      [
        requireTenantId(),
        'customerId' in key ? key.customerId : key.phone,
        'phone' in key ? key.phone : null,
      ],
      { name: 'customer.blockFor', primary: true },
    );
  }

  /** Block by account and/or mobile; the unique indexes turn a repeat into a 409. */
  async block(input: {
    customerId: string | null;
    phone: string | null;
    reason: string;
    by: string | null;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO customer_blocks (tenant_id, customer_id, phone, reason, blocked_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [requireTenantId(), input.customerId, input.phone, input.reason, input.by],
      { name: 'customer.block', primary: true },
    );
  }

  /** Lifts every block on this account and its mobile; false when there was none. */
  async unblock(customerId: string | null, phone: string | null): Promise<boolean> {
    const n = await this.db.execute_(
      `DELETE FROM customer_blocks
        WHERE tenant_id = $1 AND (($2::uuid IS NOT NULL AND customer_id = $2) OR ($3::text IS NOT NULL AND phone = $3))`,
      [requireTenantId(), customerId, phone],
      { name: 'customer.unblock', primary: true },
    );
    return n > 0;
  }

  /** Checked when seats are held: the signed-in account or the booking mobile is blocked by this operator. */
  async isBlocked(
    customerId: UserId | null | undefined,
    phone: string | null | undefined,
  ): Promise<boolean> {
    const mobile = mobileKey(phone);
    if (!customerId && !mobile) return false;
    const row = await this.db.queryOne(
      `SELECT 1 FROM customer_blocks
        WHERE tenant_id = $1 AND ((customer_id = $2::uuid) OR (phone = $3::text)) LIMIT 1`,
      [requireTenantId(), customerId ?? null, mobile],
      { name: 'customer.isBlocked' },
    );
    return !!row;
  }
}
