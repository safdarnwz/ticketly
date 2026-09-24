-- =============================================================================
-- 0059_fare_plan_weekdays
-- Weekday / weekend tariffs: a fare plan can apply only on some weekdays
-- (ISO 1 = Mon … 7 = Sun; NULL = every day). Together with the existing
-- effective_from / effective_to this gives regular, weekend, seasonal and
-- special-day tariffs, selected per JOURNEY DATE (see fare-plan-selection.ts).
-- =============================================================================

-- migrate:up
ALTER TABLE fare_plans ADD COLUMN IF NOT EXISTS weekdays smallint[]
  CHECK (weekdays IS NULL OR (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND cardinality(weekdays) BETWEEN 1 AND 7));
ALTER TABLE fare_plans ADD CONSTRAINT fare_plans_valid_window
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to);

-- migrate:down
ALTER TABLE fare_plans DROP CONSTRAINT IF EXISTS fare_plans_valid_window;
ALTER TABLE fare_plans DROP COLUMN IF EXISTS weekdays;
