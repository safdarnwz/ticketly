-- =============================================================================
-- 0072_drop_channel_partners
--
-- channel_partners (0010) modelled per-operator OTA partners for the old
-- distribution API. Nothing in the application ever read or wrote it; OTAs and
-- multi-operator agents are GDS partners (gds_partners, 0060), and outbound
-- webhooks live in partner_webhooks (0071). Dropped to leave one partner model.
-- =============================================================================

-- migrate:up
DROP TABLE IF EXISTS channel_partners;

-- migrate:down
CREATE TABLE channel_partners (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  code            text NOT NULL,
  commission_pct  numeric(5,2) NOT NULL DEFAULT 0,
  webhook_url     text,
  webhook_secret  text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER channel_partners_updated_at BEFORE UPDATE ON channel_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('channel_partners');
