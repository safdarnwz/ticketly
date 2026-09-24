import { Injectable } from '@nestjs/common';

import { type BookingId, type Json, type UserId } from '@kernel';

import { scoreRisk, type RiskResult, type RiskSignals } from '../../domain/risk-scorer';
import { FraudRepository } from '../../infrastructure/persistence/fraud.repository';

/**
 * Fraud/risk assessment. Scores a booking/payment attempt from transparent,
 * attributable signals (velocity, account age, value, disposable email, country
 * mismatch, …) and records the decision for audit and manual review. The score
 * is a pure function (risk-scorer.ts); this service just persists it and exposes
 * the review queue. `allow`/`review`/`deny` is advisory to the booking flow —
 * the caller decides whether to hard-block on `deny` or route to step-up auth.
 */
@Injectable()
export class FraudService {
  constructor(private readonly repo: FraudRepository) {}

  async assess(input: { signals: RiskSignals; bookingId?: BookingId; customerId?: UserId }): Promise<RiskResult & { assessmentId: string }> {
    const result = scoreRisk(input.signals);
    const assessmentId = await this.repo.insert({
      bookingId: input.bookingId ?? null,
      customerId: input.customerId ?? null,
      result,
      signals: input.signals as unknown as Json,
    });
    return { ...result, assessmentId };
  }

  async forBooking(bookingId: BookingId): Promise<unknown | null> {
    return this.repo.latestForBooking(bookingId);
  }

  async reviewQueue(limit = 50): Promise<unknown[]> {
    return this.repo.listForReview(limit);
  }
}
