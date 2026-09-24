import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type UserId } from '@kernel';
import { FieldEncryptor } from '@security';

export interface CustomerProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  blacklistedAt: string | null;
  blacklistReason: string | null;
  preferences: Record<string, unknown>;
  totalBookings: number;
  totalSpentMinor: number;
  isFrequentTraveller: boolean;
}

/** Frequent traveller: an operator-configurable threshold would be nicer, but 5+ confirmed bookings is a reasonable, simple default that needs no extra settings screen for v1. */
const FREQUENT_TRAVELLER_THRESHOLD = 5;

/**
 * email/phone are encrypted at rest (see UserRepository — blind-indexed for
 * EXACT lookup only, never partial). So "search" here means: partial match
 * on the plaintext full_name column, OR exact match on phone/email via their
 * blind index — never ILIKE on the encrypted columns themselves, which would
 * just fail to match anything (or worse, silently return nothing and look
 * like "no such customer" when really the query just can't work that way).
 */
@Injectable()
export class CustomerRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryptor: FieldEncryptor,
  ) {}

  async search(query: string): Promise<CustomerProfile[]> {
    const q = query.trim();
    const phoneBlind = this.encryptor.blindIndex(q);
    const rows = await this.db.query<Row>(
      `SELECT u.id, u.full_name, u.email, u.phone, u.blacklisted_at, u.blacklist_reason, u.preferences,
              coalesce(b.total_bookings, 0) AS total_bookings, coalesce(b.total_spent_minor, 0) AS total_spent_minor
         FROM users u
         LEFT JOIN (
           SELECT customer_id, count(*) AS total_bookings, sum(total_minor) AS total_spent_minor
             FROM bookings WHERE tenant_id = $1 AND status = 'confirmed' GROUP BY customer_id
         ) b ON b.customer_id = u.id
        WHERE u.tenant_id = $1 AND u.kind = 'customer' AND u.deleted_at IS NULL
          AND (u.full_name ILIKE $2 OR u.phone_blind = $3 OR u.email_blind = $3)
        ORDER BY u.created_at DESC LIMIT 25`,
      [requireTenantId(), `%${q}%`, phoneBlind],
      { name: 'customer.search' },
    );
    return rows.map((r) => this.map(r));
  }

  async profile(customerId: UserId): Promise<CustomerProfile | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT u.id, u.full_name, u.email, u.phone, u.blacklisted_at, u.blacklist_reason, u.preferences,
              coalesce(b.total_bookings, 0) AS total_bookings, coalesce(b.total_spent_minor, 0) AS total_spent_minor
         FROM users u
         LEFT JOIN (
           SELECT customer_id, count(*) AS total_bookings, sum(total_minor) AS total_spent_minor
             FROM bookings WHERE tenant_id = $1 AND status = 'confirmed' GROUP BY customer_id
         ) b ON b.customer_id = u.id
        WHERE u.tenant_id = $1 AND u.id = $2 AND u.kind = 'customer' AND u.deleted_at IS NULL`,
      [requireTenantId(), customerId],
      { name: 'customer.profile' },
    );
    return row ? this.map(row) : null;
  }

  async bookingHistory(customerId: UserId, limit = 50): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, pnr, status, total_minor AS "totalMinor", created_at AS "createdAt"
         FROM bookings WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT $3`,
      [requireTenantId(), customerId, Math.min(limit, 200)],
      { name: 'customer.bookingHistory' },
    );
  }

  async setBlacklist(customerId: UserId, blacklisted: boolean, reason?: string): Promise<void> {
    await this.db.execute_(
      `UPDATE users SET blacklisted_at = $3, blacklist_reason = $4 WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        customerId,
        blacklisted ? new Date() : null,
        blacklisted ? (reason ?? null) : null,
      ],
      { name: 'customer.setBlacklist', primary: true },
    );
  }

  async isBlacklisted(customerId: UserId): Promise<boolean> {
    const row = await this.db.queryOne<{ blacklisted_at: Date | null }>(
      `SELECT blacklisted_at FROM users WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), customerId],
      { name: 'customer.isBlacklisted' },
    );
    return !!row?.blacklisted_at;
  }

  /** Used at hold() time — guest checkout has no logged-in customerId, only a contact phone, so blacklist enforcement has to work off that. */
  async isBlacklistedByPhone(phone: string): Promise<boolean> {
    const row = await this.db.queryOne<{ blacklisted_at: Date | null }>(
      `SELECT blacklisted_at FROM users WHERE tenant_id = $1 AND phone_blind = $2 AND blacklisted_at IS NOT NULL LIMIT 1`,
      [requireTenantId(), this.encryptor.blindIndex(phone)],
      { name: 'customer.isBlacklistedByPhone' },
    );
    return !!row?.blacklisted_at;
  }

  async setPreferences(customerId: UserId, preferences: Record<string, unknown>): Promise<void> {
    await this.db.execute_(
      `UPDATE users SET preferences = preferences || $3::jsonb WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), customerId, JSON.stringify(preferences)],
      { name: 'customer.setPreferences', primary: true },
    );
  }

  private map(r: Row): CustomerProfile {
    return {
      id: r.id,
      fullName: r.full_name,
      email: this.encryptor.decrypt(r.email),
      phone: this.encryptor.decrypt(r.phone),
      blacklistedAt: r.blacklisted_at,
      blacklistReason: r.blacklist_reason,
      preferences: r.preferences ?? {},
      totalBookings: Number(r.total_bookings),
      totalSpentMinor: Number(r.total_spent_minor),
      isFrequentTraveller: Number(r.total_bookings) >= FREQUENT_TRAVELLER_THRESHOLD,
    };
  }
}

interface Row {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  blacklisted_at: string | null;
  blacklist_reason: string | null;
  preferences: Record<string, unknown>;
  total_bookings: string;
  total_spent_minor: string;
}
