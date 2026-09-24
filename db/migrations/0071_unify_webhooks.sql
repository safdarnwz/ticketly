-- =============================================================================
-- 0071_unify_webhooks
--
-- One outbound-webhook engine for everyone who receives Ticketly events:
--   - an OPERATOR's own endpoints (tenant_id set) — e.g. their ERP or a
--     directly-contracted OTA;
--   - a platform GDS PARTNER's endpoint (gds_partner_id set) — events about
--     the bookings that partner sold.
-- GDS partners used to have webhook_url / webhook_secret columns that nothing
-- ever delivered to; they move into partner_webhooks so the same signing,
-- delivery log and retry schedule apply.
-- =============================================================================

-- migrate:up
ALTER TABLE partner_webhooks ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE partner_webhooks ADD COLUMN gds_partner_id uuid REFERENCES gds_partners(id) ON DELETE CASCADE;
ALTER TABLE partner_webhooks ADD CONSTRAINT partner_webhooks_one_owner
  CHECK ((tenant_id IS NULL) <> (gds_partner_id IS NULL));
CREATE INDEX partner_webhooks_gds_partner_idx ON partner_webhooks (gds_partner_id) WHERE revoked_at IS NULL;

INSERT INTO partner_webhooks (gds_partner_id, name, url, secret)
SELECT id, name || ' (GDS)', webhook_url, coalesce(webhook_secret, encode(gen_random_bytes(32), 'hex'))
  FROM gds_partners
 WHERE webhook_url IS NOT NULL;

ALTER TABLE gds_partners DROP COLUMN webhook_url;
ALTER TABLE gds_partners DROP COLUMN webhook_secret;

-- migrate:down
ALTER TABLE gds_partners ADD COLUMN webhook_url text CHECK (webhook_url IS NULL OR webhook_url ~ '^https://');
ALTER TABLE gds_partners ADD COLUMN webhook_secret text;
UPDATE gds_partners p SET webhook_url = w.url, webhook_secret = w.secret
  FROM partner_webhooks w WHERE w.gds_partner_id = p.id AND w.revoked_at IS NULL;
DELETE FROM partner_webhooks WHERE gds_partner_id IS NOT NULL;
DROP INDEX IF EXISTS partner_webhooks_gds_partner_idx;
ALTER TABLE partner_webhooks DROP CONSTRAINT IF EXISTS partner_webhooks_one_owner;
ALTER TABLE partner_webhooks DROP COLUMN IF EXISTS gds_partner_id;
ALTER TABLE partner_webhooks ALTER COLUMN tenant_id SET NOT NULL;
