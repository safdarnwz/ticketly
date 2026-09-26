-- migrate:up
-- 0097_branch_code
-- A short code for each branch (e.g. JPR-SND), used on counter receipts, reports
-- and agent assignment. Unique per operator, ignoring case; optional for branches
-- created before this.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS code text;
CREATE UNIQUE INDEX IF NOT EXISTS branches_tenant_code_uq ON branches (tenant_id, upper(code)) WHERE code IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS branches_tenant_code_uq;
ALTER TABLE branches DROP COLUMN IF EXISTS code;
