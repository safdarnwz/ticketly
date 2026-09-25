-- =============================================================================
-- 0091_review_reply
--
-- Operators could not answer a review or report an abusive one. Add the
-- operator's public reply (one per review, editable) and a report for the
-- platform to look at — an operator never hides a review itself, or ratings
-- would only ever go up.
-- =============================================================================

-- migrate:up
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS reply text,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS report_reason text,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS reviews_tenant_recent_idx ON reviews (tenant_id, created_at DESC);

-- migrate:down
DROP INDEX IF EXISTS reviews_tenant_recent_idx;
ALTER TABLE reviews
  DROP COLUMN IF EXISTS reported_by,
  DROP COLUMN IF EXISTS reported_at,
  DROP COLUMN IF EXISTS report_reason,
  DROP COLUMN IF EXISTS replied_by,
  DROP COLUMN IF EXISTS replied_at,
  DROP COLUMN IF EXISTS reply;
