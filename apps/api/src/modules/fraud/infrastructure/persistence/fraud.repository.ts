import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type BookingId, type Json, type UserId } from '@kernel';

import type { RiskResult } from '../../domain/risk-scorer';

/** PLATFORM-WIDE (see migration 0018) — one risk/fraud review queue across every operator. */
@Injectable()
export class FraudRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: {
    bookingId: BookingId | null; customerId: UserId | null; result: RiskResult; signals: Json;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO fraud_assessments (id, booking_id, customer_id, score, band, decision, reasons, signals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.bookingId, input.customerId, input.result.score, input.result.band, input.result.decision,
       JSON.stringify(input.result.reasons), JSON.stringify(input.signals)],
      { name: 'fraud.insert', primary: true },
    );
    return id;
  }

  async latestForBooking(bookingId: BookingId): Promise<unknown | null> {
    return this.db.queryOne(
      `SELECT id, score, band, decision, reasons, created_at AS "createdAt"
         FROM fraud_assessments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [bookingId],
      { name: 'fraud.latestForBooking', primary: true },
    );
  }

  async listForReview(limit = 50): Promise<unknown[]> {
    return this.db.query(
      `SELECT fa.id, fa.booking_id AS "bookingId", b.pnr, b.contact_phone AS "contactPhone",
              fa.score, fa.band, fa.decision, fa.reasons, fa.created_at AS "createdAt"
         FROM fraud_assessments fa
         JOIN bookings b ON b.id = fa.booking_id
        WHERE fa.decision IN ('review','deny')
        ORDER BY fa.created_at DESC LIMIT $1`,
      [Math.min(limit, 200)],
      { name: 'fraud.listForReview' },
    );
  }
}
