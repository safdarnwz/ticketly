-- =============================================================================
-- 0082_booking_ancillary_gst
--
-- The GST charged on each add-on line, as charged. Add-ons on a held booking
-- can now be replaced (the customer changes their mind at checkout), and the
-- booking's total and tax must come down by exactly what was added — not by
-- a recomputation at today's rate.
-- =============================================================================

-- migrate:up
ALTER TABLE booking_ancillaries ADD COLUMN gst_minor bigint NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE booking_ancillaries DROP COLUMN IF EXISTS gst_minor;
