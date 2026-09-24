-- =============================================================================
-- 0023_commission_gst_and_operator_passthrough
--
-- Business-model correction: the platform's revenue is ONLY its commission
-- plus GST on that commission (the platform's facilitation/agent service is
-- itself a taxable supply, typically at the standard services rate — 18% in
-- India — which is DIFFERENT from the reduced rate on passenger transport
-- itself, ~5%). The fare and the TICKET's GST both belong to the operator —
-- they are the actual transport supplier and are the one who must remit that
-- GST to the government, not the platform.
--
-- Before this migration, `captureEntry` held the ticket's GST in a
-- platform-side `tax_payable` liability — meaning the platform was
-- (unintentionally) collecting and holding money that was never its own to
-- keep. This adds the settings and a new ledger account so the platform's
-- own commission-service tax is tracked SEPARATELY, and the ticket's fare +
-- GST both flow straight through to the operator's payable.
-- =============================================================================

-- migrate:up

INSERT INTO platform_settings (key, value) VALUES
  ('commission_gst_rate_pct', '18'::jsonb)  -- standard GST rate on agent/commission services, NOT the ticket's transport rate
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM platform_settings WHERE key = 'commission_gst_rate_pct';
