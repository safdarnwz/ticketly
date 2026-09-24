import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { AppError, ErrorCode, newId, requireTenantId } from '@kernel';

import type { Coupon } from '../../domain/pricing-engine';

/**
 * Coupon lookup and atomic redemption.
 *
 * `validateAndLoad` returns the coupon in the engine's shape only if it is
 * active and within its validity window and redemption cap. `redeem` bumps the
 * usage counter with a CONDITIONAL update — `WHERE usage_count < max_redemptions`
 * — so two concurrent bookings can never push a limited coupon past its cap
 * (the classic "last coupon sold twice" race).
 */
@Injectable()
export class CouponRepository {
  constructor(private readonly db: DatabaseService) {}

  /** @param journeyDate YYYY-MM-DD — the coupon is refused on its blackout dates. */
  async validateAndLoad(
    code: string,
    customerId?: string,
    journeyDate?: string,
  ): Promise<Coupon | null> {
    const row = await this.db.queryOne<CouponRow>(
      `SELECT id, code, kind, value, max_discount_minor, min_fare_minor,
              valid_from, valid_to, max_redemptions, usage_count, first_booking_only, per_user_limit
         FROM coupons
        WHERE tenant_id = $1 AND code = $2 AND is_active
          AND (valid_from IS NULL OR valid_from <= now())
          AND (valid_to IS NULL OR valid_to >= now())
          AND ($3::date IS NULL OR NOT ($3::date = ANY(blackout_dates)))`,
      [requireTenantId(), code.trim().toUpperCase(), journeyDate ?? null],
      { name: 'coupon.validateAndLoad', primary: true },
    );
    if (!row) return null;
    if (row.max_redemptions !== null && row.usage_count >= row.max_redemptions) return null;
    if (row.first_booking_only && customerId) {
      const priorBooking = await this.db.queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM bookings WHERE tenant_id = $1 AND customer_id = $2 AND status = 'confirmed'`,
        [requireTenantId(), customerId],
        { name: 'coupon.checkFirstBooking' },
      );
      if (Number(priorBooking?.n ?? 0) > 0) return null; // not their first booking — coupon doesn't apply
    }
    // Per-customer redemption limit — checked against customer_id (the
    // permanent account), NEVER contact_phone/contact_email (both are
    // editable profile fields; keying this check on either would let
    // someone reuse a coupon simply by changing their phone or email
    // between bookings, which is exactly the bypass this check exists to
    // close). Defaults to ONCE per customer even when per_user_limit was
    // never explicitly set on the coupon — a coupon reusable without limit
    // by the SAME logged-in account is a bug, not a feature, unless an
    // operator deliberately configured a higher (or unlimited, via a
    // dedicated flag — not modeled here) limit.
    if (customerId) {
      const limit = row.per_user_limit ?? 1;
      const priorUses = await this.db.queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM bookings
          WHERE tenant_id = $1 AND customer_id = $2 AND coupon_code = $3 AND status IN ('confirmed', 'held')`,
        [requireTenantId(), customerId, row.code],
        { name: 'coupon.checkPerUserLimit' },
      );
      if (Number(priorUses?.n ?? 0) >= limit) return null; // this customer already used this coupon the maximum number of times
    }
    return {
      code: row.code,
      kind: row.kind as 'percent' | 'flat',
      value: Number(row.value),
      maxDiscountMinor: row.max_discount_minor ?? undefined,
      minFareMinor: row.min_fare_minor ?? undefined,
    };
  }

  /**
   * Atomically consume one redemption. Throws PRICING_COUPON_INVALID if the
   * coupon has hit its cap between validation and redemption (Part 7 calls this
   * inside the booking transaction).
   */
  async redeem(code: string): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE coupons SET usage_count = usage_count + 1, updated_at = now()
        WHERE tenant_id = $1 AND code = $2 AND is_active
          AND (max_redemptions IS NULL OR usage_count < max_redemptions)`,
      [requireTenantId(), code.trim().toUpperCase()],
      { name: 'coupon.redeem', primary: true },
    );
    if (affected === 0) {
      throw new AppError(ErrorCode.PRICING_COUPON_INVALID, 422, {
        message: 'Coupon is no longer available',
      });
    }
  }

  async create(input: {
    code: string;
    kind: 'percent' | 'flat';
    value: number;
    maxDiscountMinor?: number;
    minFareMinor?: number;
    validFrom?: string;
    validTo?: string;
    maxRedemptions?: number;
    perUserLimit?: number;
    blackoutDates?: string[];
    firstBookingOnly?: boolean;
    description?: string;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO coupons (id, tenant_id, code, kind, value, max_discount_minor, min_fare_minor,
                            valid_from, valid_to, max_redemptions, per_user_limit, first_booking_only, description, blackout_dates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date[])`,
      [
        id,
        requireTenantId(),
        input.code.trim().toUpperCase(),
        input.kind,
        input.value,
        input.maxDiscountMinor ?? null,
        input.minFareMinor ?? null,
        input.validFrom ?? null,
        input.validTo ?? null,
        input.maxRedemptions ?? null,
        input.perUserLimit ?? null,
        input.firstBookingOnly ?? false,
        input.description ?? null,
        [...new Set(input.blackoutDates ?? [])],
      ],
      { name: 'coupon.create', primary: true },
    );
    return id;
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.db.execute_(
      `UPDATE coupons SET is_active = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, isActive],
      { name: 'coupon.setActive', primary: true },
    );
  }

  async list(): Promise<
    {
      id: string;
      code: string;
      kind: string;
      value: number;
      usageCount: number;
      maxRedemptions: number | null;
      validFrom: Date | null;
      validTo: Date | null;
      isActive: boolean;
      firstBookingOnly: boolean;
      description: string | null;
    }[]
  > {
    return this.db.query(
      `SELECT id, code, kind, value, usage_count AS "usageCount", max_redemptions AS "maxRedemptions",
              valid_from AS "validFrom", valid_to AS "validTo", is_active AS "isActive",
              first_booking_only AS "firstBookingOnly", description
         FROM coupons WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [requireTenantId()],
      { name: 'coupon.list' },
    );
  }

  /** Per-coupon usage stats — redemptions and (approximately) how much discount they've given out, derived from bookings that carried this coupon code. */
  async stats(id: string): Promise<{
    usageCount: number;
    maxRedemptions: number | null;
    estimatedDiscountGivenMinor: number;
  }> {
    const row = await this.db.queryOne<{
      usage_count: number;
      max_redemptions: number | null;
      code: string;
    }>(
      `SELECT usage_count, max_redemptions, code FROM coupons WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'coupon.stats' },
    );
    if (!row) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Coupon not found' });
    const discount = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(discount_minor), 0) AS total FROM bookings WHERE tenant_id = $1 AND coupon_code = $2`,
      [requireTenantId(), row.code],
      { name: 'coupon.discountTotal' },
    );
    return {
      usageCount: row.usage_count,
      maxRedemptions: row.max_redemptions,
      estimatedDiscountGivenMinor: Number(discount?.total ?? 0),
    };
  }
}

interface CouponRow {
  id: string;
  code: string;
  kind: string;
  value: number;
  max_discount_minor: number | null;
  min_fare_minor: number | null;
  valid_from: Date | null;
  valid_to: Date | null;
  max_redemptions: number | null;
  usage_count: number;
  first_booking_only: boolean;
  per_user_limit: number | null;
}
