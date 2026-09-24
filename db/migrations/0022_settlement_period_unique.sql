-- =============================================================================
-- 0022_settlement_period_unique
--
-- `settlements` had only a plain index on (tenant_id, period_from, period_to)
-- — nothing at the database level stopped the SAME period being settled
-- twice for the same operator, which is exactly the kind of double-payout
-- "leakage" this platform cannot afford. This makes it a hard constraint, and
-- SettlementService.generate() now checks-and-reuses instead of blindly
-- inserting, so the new automated weekly payout scheduler (Mon–Wed → payout
-- Thursday, Thu–Sun → payout Monday) can run safely even if it somehow fires
-- twice for the same window (a retried job, a restart mid-run, etc.).
-- =============================================================================

-- migrate:up

-- If a genuine duplicate somehow already exists, keep the earliest (already-
-- possibly-paid) one and remove the rest before adding the constraint —
-- otherwise the ALTER TABLE below fails outright, which is the correct
-- behaviour (surface the conflict, don't silently pick one), but we make the
-- resolution deterministic and non-destructive of money-moving state.
DELETE FROM settlements a USING settlements b
 WHERE a.tenant_id = b.tenant_id AND a.period_from = b.period_from AND a.period_to = b.period_to
   AND a.id > b.id AND a.status = 'draft';

CREATE UNIQUE INDEX settlements_period_unique_idx ON settlements (tenant_id, period_from, period_to);

-- The old plain (non-unique) index on the same columns is now redundant.
DROP INDEX IF EXISTS settlements_period_idx;

-- migrate:down

DROP INDEX IF EXISTS settlements_period_unique_idx;
CREATE INDEX settlements_period_idx ON settlements (tenant_id, period_from, period_to);
