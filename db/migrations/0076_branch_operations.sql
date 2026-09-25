-- =============================================================================
-- 0076_branch_operations
--
-- Branch operations from the scenario tracker (#129, #193):
--   - branches.working_hours: opening hours per weekday, e.g.
--     {"mon": {"open": "08:00", "close": "22:00"}, "sun": null}; a missing
--     or null day is closed. An empty object means "hours not set".
--   - user_branches: staff can work at more than one branch. users.branch_id
--     stays the PRIMARY branch (reports and the agent link use it); this
--     table lists every branch the user is assigned to, primary included.
-- =============================================================================

-- migrate:up
ALTER TABLE branches ADD COLUMN working_hours jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE user_branches (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX user_branches_branch_idx ON user_branches (branch_id);
SELECT apply_tenant_rls('user_branches');

-- Everyone already on a branch is assigned to it.
INSERT INTO user_branches (tenant_id, user_id, branch_id)
SELECT tenant_id, id, branch_id FROM users WHERE branch_id IS NOT NULL AND tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- migrate:down
DROP TABLE IF EXISTS user_branches;
ALTER TABLE branches DROP COLUMN IF EXISTS working_hours;
