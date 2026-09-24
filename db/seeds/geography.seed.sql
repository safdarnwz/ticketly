-- =============================================================================
-- geography.seed.sql
--
-- Genuinely missing until now: `countries`/`states`/`cities` had NO seed data
-- anywhere in this codebase. Without at least two cities, master-data.routes
-- cannot be created (needs originCityId/destCityId) and search cannot return
-- anything. Deliberately includes an INTER-state pair (Delhi ↔ Jaipur, two
-- different states) and an INTRA-state pair (Bangalore ↔ Mysuru, same state)
-- so the GST place-of-supply logic (CGST+SGST vs IGST — see
-- RouteRepository.isInterState) is exercised both ways in test data.
--
-- Run once: npm run db:seed:geography
-- =============================================================================

INSERT INTO countries (id, iso2, name, dial_code, currency)
VALUES ('00000000-0000-7000-8000-000000000001', 'IN', 'India', '+91', 'INR')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO states (id, country_id, code, name) VALUES
  ('00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000001', 'DL', 'Delhi'),
  ('00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000001', 'RJ', 'Rajasthan'),
  ('00000000-0000-7000-8000-000000000013', '00000000-0000-7000-8000-000000000001', 'KA', 'Karnataka')
ON CONFLICT (country_id, code) DO NOTHING;

INSERT INTO cities (id, state_id, name, latitude, longitude, timezone) VALUES
  ('00000000-0000-7000-8000-000000000021', '00000000-0000-7000-8000-000000000011', 'Delhi', 28.7041, 77.1025, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000022', '00000000-0000-7000-8000-000000000012', 'Jaipur', 26.9124, 75.7873, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000023', '00000000-0000-7000-8000-000000000013', 'Bangalore', 12.9716, 77.5946, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000024', '00000000-0000-7000-8000-000000000013', 'Mysuru', 12.2958, 76.6394, 'Asia/Kolkata'),
  -- Intermediate stops for the demo routes (multi-operator.seed.sql) — a
  -- realistic Delhi→Jaipur or Bangalore→Mysuru service almost always has
  -- at least one midway boarding/dropping point, not just origin+dest.
  -- Both fit into states already seeded above, so no new state is needed.
  ('00000000-0000-7000-8000-000000000025', '00000000-0000-7000-8000-000000000012', 'Alwar', 27.5530, 76.6346, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000026', '00000000-0000-7000-8000-000000000013', 'Channapatna', 12.6514, 77.2065, 'Asia/Kolkata')
ON CONFLICT (id) DO NOTHING;
