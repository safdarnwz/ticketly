-- =============================================================================
-- 0029_branches
--
-- Multi-branch support — an operator with more than one physical office/
-- counter (e.g. separate counters at Delhi ISBT and Jaipur Sindhi Camp) can
-- track staff and cash-counter sales per branch. Deliberately simple: a
-- branch is a location + manager; staff are optionally tagged with one via
-- users.branch_id for reporting (branch-wise sales — see the checklist).
-- =============================================================================

-- migrate:up

CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  phone           text,
  manager_user_id uuid REFERENCES users(id),
  status          text NOT NULL DEFAULT 'active',  -- 'active' | 'inactive'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('branches');

ALTER TABLE users ADD COLUMN branch_id uuid REFERENCES branches(id);

-- migrate:down

ALTER TABLE users DROP COLUMN IF EXISTS branch_id;
DROP TABLE IF EXISTS branches;
