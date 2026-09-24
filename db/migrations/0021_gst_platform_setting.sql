-- =============================================================================
-- 0021_gst_platform_setting
--
-- GST is a GOVERNMENT-mandated rate, not a business choice — an operator being
-- able to set their own GST% (as pricing_policies.gst_rate_pct allowed, via
-- PricingController.createPolicy) is exactly the kind of thing that produces a
-- wrong GST filing (over- or under-charging the government, or worse,
-- pocketing tax that was never remitted). This adds it as a platform setting
-- next to commission and the per-bus fee; PricingService now reads the rate
-- from here, and PricingController.createPolicy silently ignores any gstRatePct
-- an operator sends (the column stays on pricing_policies for now — legacy,
-- unread — rather than risk a destructive column drop).
-- =============================================================================

-- migrate:up

INSERT INTO platform_settings (key, value) VALUES
  ('gst_rate_pct', '5'::jsonb)  -- government-mandated GST rate — NEVER operator-settable
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM platform_settings WHERE key = 'gst_rate_pct';
