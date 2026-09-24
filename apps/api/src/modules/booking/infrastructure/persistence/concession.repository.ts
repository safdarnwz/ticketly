import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId } from '@kernel';

import { DEFAULT_BOOKING_WINDOW, DEFAULT_POLICY, type BookingWindow, type Category, type ConcessionRule, type PassengerPolicy } from '../../domain/passenger-categories';

/** The operator's concession rules and passenger policy (small; read once per hold). */
@Injectable()
export class ConcessionRepository {
  constructor(private readonly db: DatabaseService) {}

  async rules(): Promise<ConcessionRule[]> {
    const rows = await this.db.query<{ category: Category; discount_pct: string; min_age: number | null; max_age: number | null; requires_id_proof: boolean; valid_from: string | null; valid_to: string | null; max_per_booking: number | null; active: boolean }>(
      `SELECT category, discount_pct, min_age, max_age, requires_id_proof, valid_from::text AS valid_from, valid_to::text AS valid_to, max_per_booking, active
         FROM concession_rules WHERE tenant_id = $1`, [requireTenantId()], { name: 'concession.rules' });
    return rows.map((r) => ({ category: r.category, discountPct: Number(r.discount_pct), minAge: r.min_age, maxAge: r.max_age, requiresIdProof: r.requires_id_proof, validFrom: r.valid_from, validTo: r.valid_to, maxPerBooking: r.max_per_booking, active: r.active }));
  }

  async policy(): Promise<PassengerPolicy> {
    const r = await this.db.queryOne<{ adult_age: number; infant_max_age: number; infant_fee_minor: string; allow_unaccompanied_minors: boolean }>(
      `SELECT adult_age, infant_max_age, infant_fee_minor, allow_unaccompanied_minors FROM passenger_policies WHERE tenant_id = $1`, [requireTenantId()], { name: 'concession.policy' });
    return r ? { adultAge: r.adult_age, infantMaxAge: r.infant_max_age, infantFeeMinor: Number(r.infant_fee_minor), allowUnaccompaniedMinors: r.allow_unaccompanied_minors } : DEFAULT_POLICY;
  }

  async bookingWindow(): Promise<BookingWindow> {
    const r = await this.db.queryOne<{ max_advance_days: number | null; min_minutes_before_departure: number }>(
      `SELECT max_advance_days, min_minutes_before_departure FROM passenger_policies WHERE tenant_id = $1`, [requireTenantId()], { name: 'policy.bookingWindow' });
    return r ? { maxAdvanceDays: r.max_advance_days, minMinutesBeforeDeparture: r.min_minutes_before_departure } : DEFAULT_BOOKING_WINDOW;
  }

  async setBookingWindow(w: BookingWindow): Promise<void> {
    await this.db.execute_(
      `INSERT INTO passenger_policies (tenant_id, max_advance_days, min_minutes_before_departure) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET max_advance_days = EXCLUDED.max_advance_days, min_minutes_before_departure = EXCLUDED.min_minutes_before_departure, updated_at = now()`,
      [requireTenantId(), w.maxAdvanceDays, w.minMinutesBeforeDeparture], { name: 'policy.setBookingWindow', primary: true });
  }

  async upsertRule(r: ConcessionRule): Promise<void> {
    await this.db.execute_(
      `INSERT INTO concession_rules (tenant_id, category, discount_pct, min_age, max_age, requires_id_proof, valid_from, valid_to, max_per_booking, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, category) DO UPDATE SET discount_pct = EXCLUDED.discount_pct, min_age = EXCLUDED.min_age, max_age = EXCLUDED.max_age,
         requires_id_proof = EXCLUDED.requires_id_proof, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
         max_per_booking = EXCLUDED.max_per_booking, active = EXCLUDED.active, updated_at = now()`,
      [requireTenantId(), r.category, r.discountPct, r.minAge, r.maxAge, r.requiresIdProof, r.validFrom, r.validTo, r.maxPerBooking, r.active],
      { name: 'concession.upsert', primary: true });
  }

  async setPolicy(p: PassengerPolicy): Promise<void> {
    await this.db.execute_(
      `INSERT INTO passenger_policies (tenant_id, adult_age, infant_max_age, infant_fee_minor, allow_unaccompanied_minors) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id) DO UPDATE SET adult_age = EXCLUDED.adult_age, infant_max_age = EXCLUDED.infant_max_age,
         infant_fee_minor = EXCLUDED.infant_fee_minor, allow_unaccompanied_minors = EXCLUDED.allow_unaccompanied_minors, updated_at = now()`,
      [requireTenantId(), p.adultAge, p.infantMaxAge, p.infantFeeMinor, p.allowUnaccompaniedMinors],
      { name: 'concession.setPolicy', primary: true });
  }
}
