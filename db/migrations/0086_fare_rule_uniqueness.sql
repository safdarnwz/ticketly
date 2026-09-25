-- =============================================================================
-- 0086_fare_rule_uniqueness
--
-- fare_rules was unique on (plan, from_stop, to_stop, seat_type), but a
-- whole-route rule has NULL stops and NULLs never collide — so "save the
-- seater fare" added another row every time instead of replacing it, and a
-- quote read whichever came first (a ₹0 draft rule could win and sell seats
-- for free). Keep the newest rule of each kind, drop rules priced at zero or
-- less, and make NULL stops compare equal from now on.
-- =============================================================================

-- migrate:up
DELETE FROM fare_rules d
 USING fare_rules k
 WHERE d.fare_plan_id = k.fare_plan_id
   AND d.seat_type = k.seat_type
   AND d.from_stop_id IS NOT DISTINCT FROM k.from_stop_id
   AND d.to_stop_id IS NOT DISTINCT FROM k.to_stop_id
   AND (d.created_at, d.id) < (k.created_at, k.id);

DELETE FROM fare_rules WHERE base_fare_minor <= 0;

ALTER TABLE fare_rules DROP CONSTRAINT IF EXISTS fare_rules_fare_plan_id_from_stop_id_to_stop_id_seat_type_key;
CREATE UNIQUE INDEX fare_rules_one_per_segment
  ON fare_rules (fare_plan_id, from_stop_id, to_stop_id, seat_type) NULLS NOT DISTINCT;
ALTER TABLE fare_rules ADD CONSTRAINT fare_rules_positive CHECK (base_fare_minor > 0);

-- migrate:down
ALTER TABLE fare_rules DROP CONSTRAINT IF EXISTS fare_rules_positive;
DROP INDEX IF EXISTS fare_rules_one_per_segment;
ALTER TABLE fare_rules ADD CONSTRAINT fare_rules_fare_plan_id_from_stop_id_to_stop_id_seat_type_key
  UNIQUE (fare_plan_id, from_stop_id, to_stop_id, seat_type);
