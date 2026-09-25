-- migrate:up
-- Coupons could be saved at 0% / ₹0, above 100%, or ending before they start —
-- a coupon that silently never applies (or would make a fare negative). The API
-- now refuses those; the table refuses them too. Existing bad rows are switched
-- off first so the constraints can be added.
UPDATE coupons SET is_active = false
 WHERE value <= 0
    OR (kind = 'percent' AND value > 100)
    OR (valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_to <= valid_from);
UPDATE coupons SET value = LEAST(GREATEST(value, 1), 100) WHERE kind = 'percent' AND (value <= 0 OR value > 100);
UPDATE coupons SET value = 100 WHERE kind = 'flat' AND value <= 0;
UPDATE coupons SET valid_to = NULL
 WHERE valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_to <= valid_from;

ALTER TABLE coupons
  ADD CONSTRAINT coupons_kind_check CHECK (kind IN ('percent', 'flat')),
  ADD CONSTRAINT coupons_value_check CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
  ADD CONSTRAINT coupons_window_check CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to > valid_from);

COMMENT ON CONSTRAINT coupons_value_check ON coupons IS 'A percentage is 1–100 and a flat discount at least ₹1';
COMMENT ON CONSTRAINT coupons_window_check ON coupons IS 'A coupon must end after it starts';

-- migrate:down
ALTER TABLE coupons
  DROP CONSTRAINT IF EXISTS coupons_kind_check,
  DROP CONSTRAINT IF EXISTS coupons_value_check,
  DROP CONSTRAINT IF EXISTS coupons_window_check;
