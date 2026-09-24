import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { newId, type UserId } from '@kernel';

import type { ConsentEvent, ConsentPurpose } from '../../domain/consent';

/**
 * PLATFORM-WIDE (see migration 0018) — consent/erasure are about a CUSTOMER,
 * and customers are tenant-less central accounts (see docs/ACCOUNTS_ONBOARDING.md),
 * so there is no tenant to scope this by. `anonymiseCustomerPii` is the one
 * exception worth noting: it reaches into `bookings`/`passengers`, which ARE
 * still tenant-scoped (a booking belongs to one operator) — but a customer can
 * have bookings with MANY operators, so that anonymisation deliberately has NO
 * tenant filter, updating every booking of theirs across every operator.
 */
@Injectable()
export class PrivacyRepository {
  constructor(private readonly db: DatabaseService) {}

  async appendConsent(
    customerId: UserId,
    purpose: ConsentPurpose,
    granted: boolean,
    atMs: number,
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO consents (id, customer_id, purpose, granted, created_at)
       VALUES ($1,$2,$3,$4, to_timestamp($5 / 1000.0))`,
      [newId(), customerId, purpose, granted, atMs],
      { name: 'privacy.appendConsent', primary: true },
    );
  }

  async loadConsentEvents(customerId: UserId): Promise<ConsentEvent[]> {
    const rows = await this.db.query<{ purpose: ConsentPurpose; granted: boolean; at_ms: string }>(
      `SELECT purpose, granted, (extract(epoch from created_at) * 1000)::bigint AS at_ms
         FROM consents WHERE customer_id = $1 ORDER BY created_at`,
      [customerId],
      { name: 'privacy.loadConsents', primary: true },
    );
    return rows.map((r) => ({ purpose: r.purpose, granted: r.granted, atMs: Number(r.at_ms) }));
  }

  async createErasureRequest(customerId: UserId): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO erasure_requests (id, customer_id, status) VALUES ($1,$2,'pending')`,
      [id, customerId],
      { name: 'privacy.createErasure', primary: true },
    );
    return id;
  }

  async findErasureRequest(
    id: string,
  ): Promise<{ id: string; customerId: string; status: string } | null> {
    return this.db.queryOne(
      `SELECT id, customer_id AS "customerId", status FROM erasure_requests WHERE id = $1`,
      [id],
      { name: 'privacy.findErasure', primary: true },
    );
  }

  async listErasureRequests(status?: string): Promise<unknown[]> {
    const params: unknown[] = [];
    let where = '1=1';
    if (status) {
      params.push(status);
      where = `status = $${params.length}`;
    }
    return this.db.query(
      `SELECT id, customer_id AS "customerId", status, requested_at AS "requestedAt", processed_at AS "processedAt"
         FROM erasure_requests WHERE ${where} ORDER BY requested_at DESC LIMIT 200`,
      params,
      { name: 'privacy.listErasure' },
    );
  }

  /**
   * Anonymise a customer's PII in place, keeping financial records intact
   * (invoices/ledger are legally retained). Runs in the caller's transaction.
   * NO tenant filter — a customer's bookings can span many operators.
   */
  async anonymiseCustomerPii(customerId: UserId): Promise<void> {
    const scope = currentTransaction();
    const run = scope
      ? (sql: string, p: unknown[]) => scope.client.query(sql, p)
      : (sql: string, p: unknown[]) =>
          this.db.execute_(sql, p, { name: 'privacy.anonymise', primary: true });
    await run(
      `UPDATE bookings SET contact_email = NULL, contact_phone = NULL WHERE customer_id = $1`,
      [customerId],
    );
    await run(
      `UPDATE passengers p SET full_name = '[redacted]'
         FROM bookings b WHERE p.booking_id = b.id AND b.customer_id = $1`,
      [customerId],
    );
    await run(
      `UPDATE users SET email = concat('erased+', id, '@invalid'), email_blind = NULL,
              full_name = '[redacted]', phone = NULL, phone_blind = NULL
        WHERE id = $1`,
      [customerId],
    );
  }

  async markErasureProcessed(id: string): Promise<void> {
    const scope = currentTransaction();
    const sql = `UPDATE erasure_requests SET status = 'processed', processed_at = now() WHERE id = $1`;
    if (scope) await scope.client.query(sql, [id]);
    else await this.db.execute_(sql, [id], { name: 'privacy.markProcessed', primary: true });
  }
}
