-- =============================================================================
-- 0089_webhook_url_unique
--
-- The same URL could be registered again and again for one operator — each
-- copy with its own secret and each receiving every event, so a partner got
-- duplicates it could not verify with the secret it kept. Keep the newest live
-- registration of each URL and allow only one from now on.
-- =============================================================================

-- migrate:up
UPDATE partner_webhooks d SET revoked_at = now(), is_active = false
  FROM partner_webhooks k
 WHERE d.tenant_id = k.tenant_id
   AND d.url = k.url
   AND d.revoked_at IS NULL AND k.revoked_at IS NULL
   AND (d.created_at, d.id) < (k.created_at, k.id);

CREATE UNIQUE INDEX partner_webhooks_one_per_url
  ON partner_webhooks (tenant_id, url)
  WHERE revoked_at IS NULL AND tenant_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS partner_webhooks_one_per_url;
