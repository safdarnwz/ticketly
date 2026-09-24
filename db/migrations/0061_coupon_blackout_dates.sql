-- =============================================================================
-- 0061_coupon_blackout_dates
-- Journey dates on which a coupon cannot be used (festivals, peak weekends).
-- Checked against the JOURNEY date — a coupon's valid_from/valid_to govern
-- when it can be APPLIED; blackout dates govern which trips it applies to.
-- =============================================================================

-- migrate:up
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS blackout_dates date[] NOT NULL DEFAULT '{}'
  CHECK (cardinality(blackout_dates) <= 366);

-- migrate:down
ALTER TABLE coupons DROP COLUMN IF EXISTS blackout_dates;
