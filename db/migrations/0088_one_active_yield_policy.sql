-- =============================================================================
-- 0088_one_active_yield_policy
--
-- Any number of yield policies could be active for the same route (or for the
-- whole operator), and a quote took whichever the planner returned first. A
-- new policy now replaces the earlier one of its scope; keep only the newest
-- active one of each scope and make that the rule. Multipliers of 0 (seats
-- priced at ₹0) are switched off too.
-- =============================================================================

-- migrate:up
UPDATE pricing_policies d SET is_active = false
  FROM pricing_policies k
 WHERE d.tenant_id = k.tenant_id
   AND d.route_id IS NOT DISTINCT FROM k.route_id
   AND d.is_active AND k.is_active
   AND (d.created_at, d.id) < (k.created_at, k.id);

UPDATE pricing_policies SET is_active = false
 WHERE is_active
   AND ((ladder ->> 'minMultiplier')::numeric < 0.5
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(ladder -> 'occupancy') s WHERE (s ->> 'mult')::numeric < 0.5)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(ladder -> 'advancePurchase') s WHERE (s ->> 'mult')::numeric < 0.5));

CREATE UNIQUE INDEX pricing_policies_one_active
  ON pricing_policies (tenant_id, route_id) NULLS NOT DISTINCT
  WHERE is_active;

-- migrate:down
DROP INDEX IF EXISTS pricing_policies_one_active;
