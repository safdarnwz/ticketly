-- =============================================================================
-- 0024_notification_billing
--
-- Per-message billing: every SMS costs the operator ₹0.07, every WhatsApp
-- message ₹0.10, email is free. This is a platform SERVICE (the SMS/WhatsApp
-- gateway), so — same as commission — GST applies on top and is the
-- platform's OWN liability to remit, never the operator's. Charged into the
-- existing `platform_charges` ledger (same mechanism as the per-bus fee) so
-- it nets against the operator's next scheduled payout automatically.
--
-- `base_minor`/`gst_minor` are added to `platform_charges` so every charge is
-- auditable (operator can see "7 paise fee + 1.26 paise GST" per message, not
-- just an opaque total) — this generalises cleanly to the per-bus fee too
-- (gst_minor simply 0 there, since a one-time registration fee isn't itself
-- taxed the same way — see application code).
-- =============================================================================

-- migrate:up

ALTER TABLE platform_charges ADD COLUMN base_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE platform_charges ADD COLUMN gst_minor bigint NOT NULL DEFAULT 0;

INSERT INTO platform_settings (key, value) VALUES
  ('sms_fee_minor', '7'::jsonb),        -- ₹0.07 per SMS
  ('whatsapp_fee_minor', '10'::jsonb)   -- ₹0.10 per WhatsApp message
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM platform_settings WHERE key IN ('sms_fee_minor', 'whatsapp_fee_minor');
ALTER TABLE platform_charges DROP COLUMN IF EXISTS gst_minor;
ALTER TABLE platform_charges DROP COLUMN IF EXISTS base_minor;
