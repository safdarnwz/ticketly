-- =============================================================================
-- demo-return-route.seed.sql
--
-- Demo Travels' way back: Jaipur → Alwar → Delhi, a morning bus (08:00) on the
-- same stops, bus and ₹850 fare as Delhi → Jaipur — so round trips can be
-- searched and booked (and the round-trip discount tried) on the demo.
-- Safe to run again: does nothing when the route already exists.
-- Trips are materialised by the app like the onward service's.
-- =============================================================================
DO $$
DECLARE
  v_tenant_id uuid;
  v_delhi_city uuid;
  v_jaipur_city uuid;
  v_stop_delhi uuid;
  v_stop_alwar uuid;
  v_stop_jaipur uuid;
  v_route_id uuid;
  v_vtype_id uuid;
  v_vehicle_id uuid;
  v_fare_plan_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'demo-travels';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demo Travels not found — run demo-operator.seed.sql first';
  END IF;
  IF EXISTS (SELECT 1 FROM routes WHERE tenant_id = v_tenant_id AND code = 'JAI-DEL-01') THEN
    RAISE NOTICE 'JAI-DEL-01 already there — nothing to do';
    RETURN;
  END IF;

  SELECT id INTO v_delhi_city FROM cities WHERE name = 'Delhi' LIMIT 1;
  SELECT id INTO v_jaipur_city FROM cities WHERE name = 'Jaipur' LIMIT 1;
  SELECT id INTO v_stop_delhi FROM stops WHERE tenant_id = v_tenant_id AND name = 'Kashmere Gate ISBT';
  SELECT id INTO v_stop_alwar FROM stops WHERE tenant_id = v_tenant_id AND name = 'Alwar Bus Stand';
  SELECT id INTO v_stop_jaipur FROM stops WHERE tenant_id = v_tenant_id AND name = 'Sindhi Camp Bus Stand';
  SELECT id, vehicle_type_id INTO v_vehicle_id, v_vtype_id FROM vehicles WHERE tenant_id = v_tenant_id AND registration_no = 'RJ14PA1234';

  INSERT INTO routes (id, tenant_id, code, name, origin_city_id, dest_city_id, status, total_distance_m, total_duration_min)
  VALUES (uuid_generate_v7(), v_tenant_id, 'JAI-DEL-01', 'Jaipur → Delhi', v_jaipur_city, v_delhi_city, 'published', 280000, 330)
  RETURNING id INTO v_route_id;

  INSERT INTO route_stops (id, tenant_id, route_id, stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight)
  VALUES
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_jaipur, 0, 0, 0, 0, true, false),
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_alwar, 1, 130000, 155, 10, true, true),
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_delhi, 2, 280000, 330, 0, false, true);

  INSERT INTO fare_plans (id, tenant_id, route_id, name, currency, status, effective_from)
  VALUES (uuid_generate_v7(), v_tenant_id, v_route_id, 'Standard fares', 'INR', 'active', current_date)
  RETURNING id INTO v_fare_plan_id;
  INSERT INTO fare_rules (id, tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor)
  VALUES (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, v_stop_jaipur, v_stop_delhi, 'seater', 85000);

  -- The same bus goes back in the morning (it reaches Jaipur at 03:00).
  INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence, status)
  VALUES (
    uuid_generate_v7(), v_tenant_id, 'JAI-DEL-0800', v_route_id, v_vtype_id, v_vehicle_id, 480,
    jsonb_build_object('frequency', 'daily', 'startDate', to_char(current_date, 'YYYY-MM-DD'), 'endDate', to_char(current_date + interval '90 days', 'YYYY-MM-DD')),
    'active'
  );
  RAISE NOTICE 'Demo Travels return route JAI-DEL-01 seeded — materialise its service JAI-DEL-0800 via the app';
END $$;
