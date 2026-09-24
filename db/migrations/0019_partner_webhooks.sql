-- =============================================================================
-- 0019_partner_webhooks
--
-- Real outbound webhook delivery for OTA/distribution partners (redBus,
-- Paytm-style). Until now DistributionController.catalogue() only ADVERTISED
-- event names — there was no way for a tenant to register WHERE to send them,
-- and no delivery mechanism at all. This is a real GDS requirement: a partner
-- needs push notification of trip.delayed/trip.cancelled/booking.cancelled,
-- not just polling.
-- =============================================================================

-- migrate:up

CREATE TABLE partner_webhooks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,                    -- e.g. "redBus production"
  url           text NOT NULL,
  secret        text NOT NULL,                     -- HMAC-SHA256 key, shown once at creation
  event_types   text[] NOT NULL DEFAULT '{}',       -- subset of the catalogue; empty = all
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);
CREATE INDEX partner_webhooks_tenant_idx ON partner_webhooks (tenant_id) WHERE revoked_at IS NULL;
SELECT apply_tenant_rls('partner_webhooks');

-- Delivery log — every attempt, so a partner integration issue is debuggable
-- ("did you even send it?") and failed deliveries can be retried with backoff.
CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  webhook_id      uuid NOT NULL REFERENCES partner_webhooks(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
  event_id        uuid NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'delivered' | 'failed'
  attempts        int NOT NULL DEFAULT 0,
  response_status int,
  last_error      text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_retry_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries (webhook_id, created_at DESC);
-- Exactly-once fan-out per (webhook, event): a retried outbox dispatch of the
-- SAME domain event must not queue a second delivery to the same partner URL.
CREATE UNIQUE INDEX webhook_deliveries_dedupe_idx ON webhook_deliveries (webhook_id, event_id);
SELECT apply_tenant_rls('webhook_deliveries');

-- migrate:down

DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS partner_webhooks;
