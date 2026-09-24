-- =============================================================================
-- 0016_appearance_settings
--
-- Global Settings → Appearance. Per-(tenant, scope) partial design themes, where
-- scope is a role code or '' for the tenant-wide default. The stored value is a
-- partial theme (only overridden tokens); the effective theme is resolved by
-- layering default ← tenant ← role at read time.
-- =============================================================================

-- migrate:up

CREATE TABLE appearance_settings (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope       text NOT NULL DEFAULT '',   -- '' = tenant default, else a role code
  theme       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope)
);
CREATE TRIGGER appearance_settings_updated_at BEFORE UPDATE ON appearance_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('appearance_settings');

-- migrate:down

DROP TABLE IF EXISTS appearance_settings;
