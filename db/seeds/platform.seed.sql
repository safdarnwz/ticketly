-- Seed: subscription plans the platform offers (idempotent).
INSERT INTO plans (code, name, monthly_price, currency, sort_order, features, quotas) VALUES
  ('starter',    'Starter',        0,       'INR', 1,
     '{"distribution": false, "dynamicPricing": false}'::jsonb,
     '{"maxVehicles": 25, "maxUsers": 10}'::jsonb),
  ('growth',     'Growth',      2500000,    'INR', 2,
     '{"distribution": true, "dynamicPricing": true}'::jsonb,
     '{"maxVehicles": 200, "maxUsers": 100}'::jsonb),
  ('enterprise', 'Enterprise',  9900000,    'INR', 3,
     '{"distribution": true, "dynamicPricing": true, "sso": true}'::jsonb,
     '{"maxVehicles": null, "maxUsers": null}'::jsonb)
ON CONFLICT (code) DO NOTHING;
