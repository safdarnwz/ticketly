-- =============================================================================
-- 0073_platform_charges_description
--
-- Settlement shortfalls and route-promotion purchases write a human-readable
-- description on their platform charge, but the column was never created, so
-- both INSERTs failed at runtime. Adds it (nullable: per-bus and notification
-- charges don't carry one).
-- =============================================================================

-- migrate:up
ALTER TABLE platform_charges ADD COLUMN IF NOT EXISTS description text;

-- migrate:down
ALTER TABLE platform_charges DROP COLUMN IF EXISTS description;
