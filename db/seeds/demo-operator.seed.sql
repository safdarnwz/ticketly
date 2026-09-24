-- =============================================================================
-- demo-operator.seed.sql
--
-- ONE working demo operator ("Demo Travels") with everything needed to
-- search, quote, and book a ticket end-to-end: a route (Delhi → Jaipur,
-- using the cities already in geography.seed.sql), a 2+2 seater layout, a
-- vehicle, a fare plan, and a daily recurring service.
--
-- Deliberately does NOT materialise trips here — trip materialisation is
-- genuine application logic (inventory bitmaps, per-stop timing) that's easy
-- to get SILENTLY WRONG by hand-crafting it in raw SQL. Call the app's own
-- materialise endpoint once after seeding (see README below this file / the
-- run-commands the assistant gave you) — that guarantees a correct result
-- because it's the SAME code path a real operator's schedule goes through.
--
-- Run once, AFTER geography.seed.sql and AFTER `npm run db:seed`
-- (needs roles to exist for the operator-admin login):
--   npm run db:seed:demo
-- =============================================================================

DO $$
DECLARE
  v_tenant_id uuid;
  v_delhi_city uuid;
  v_jaipur_city uuid;
  v_stop_delhi uuid;
  v_stop_jaipur uuid;
  v_stop_alwar uuid;
  v_alwar_city uuid;
  v_route_id uuid;
  v_layout_id uuid;
  v_vtype_id uuid;
  v_vehicle_id uuid;
  v_fare_plan_id uuid;
  v_operator_role_id uuid;
  v_admin_user_id uuid;
  v_seats jsonb;
BEGIN
  -- Cities from geography.seed.sql — Delhi and Jaipur (inter-state pair).
  SELECT id INTO v_delhi_city FROM cities WHERE name = 'Delhi' LIMIT 1;
  SELECT id INTO v_jaipur_city FROM cities WHERE name = 'Jaipur' LIMIT 1;
  SELECT id INTO v_alwar_city FROM cities WHERE name = 'Alwar' LIMIT 1;
  IF v_delhi_city IS NULL OR v_jaipur_city IS NULL OR v_alwar_city IS NULL THEN
    RAISE EXCEPTION 'Delhi/Jaipur not found — run geography.seed.sql first';
  END IF;

  -- 1) Tenant (operator) — active immediately, no onboarding-approval needed for a seed.
  INSERT INTO tenants (id, slug, legal_name, display_name, status, contact_email, contact_phone, gstin, registered_address,
                        bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_details_updated_at)
  VALUES (uuid_generate_v7(), 'demo-travels', 'Demo Travels Pvt Ltd', 'Demo Travels', 'active',
          'ops@demo-travels.example', '+919800000000', '08AAAAA0000A1Z5', 'Plot 12, Transport Nagar, Jaipur, Rajasthan',
          'Demo Travels Pvt Ltd', '100000000001234', 'HDFC0000001', 'HDFC Bank', now())
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN
    SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'demo-travels';
  END IF;

  -- 2) Operator-admin login — app.demo-travels.ticketly.com, admin@demo-travels.example / pass@123
  SELECT id INTO v_operator_role_id FROM roles WHERE tenant_id = v_tenant_id AND code = 'operator_admin' LIMIT 1;
  IF v_operator_role_id IS NULL THEN
    -- Clone the PLATFORM TEMPLATE 'operator_admin' role (tenant_id IS NULL,
    -- seeded in roles.seed.sql) into this tenant — the exact same source the
    -- real onboarding-approval flow clones from. Copying from 'super_admin'
    -- here would have been a genuine privilege-escalation bug: a demo
    -- operator would get PLATFORM-wide permissions (managing other tenants,
    -- cross-tenant audit access) instead of just their own account.
    INSERT INTO roles (id, tenant_id, code, name, description, is_system)
    SELECT uuid_generate_v7(), v_tenant_id, code, name, description, is_system
      FROM roles WHERE tenant_id IS NULL AND code = 'operator_admin'
    RETURNING id INTO v_operator_role_id;
    IF v_operator_role_id IS NULL THEN
      RAISE EXCEPTION 'Platform template role ''operator_admin'' not found — run roles.seed.sql first';
    END IF;
    INSERT INTO role_permissions (role_id, permission)
    SELECT v_operator_role_id, permission FROM role_permissions
     WHERE role_id = (SELECT id FROM roles WHERE tenant_id IS NULL AND code = 'operator_admin' LIMIT 1)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Default notification templates — see multi-operator.seed.sql's copy of
  -- this same comment for why this is NOT optional.
  INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body) VALUES
    (uuid_generate_v7(), v_tenant_id, 'booking.confirmed', 'sms', NULL, 'Booking confirmed! PNR {{pnr}}. Have a safe journey.'),
    (uuid_generate_v7(), v_tenant_id, 'booking.confirmed', 'email', 'Your ticket — PNR {{pnr}}', 'Your booking is confirmed. PNR: {{pnr}}.'),
    (uuid_generate_v7(), v_tenant_id, 'booking.cancelled', 'sms', NULL, 'Booking {{pnr}} cancelled. Refund of {{refundAmount}} initiated.'),
    (uuid_generate_v7(), v_tenant_id, 'booking.seats_cancelled', 'sms', NULL, 'Seat(s) {{seats}} on booking {{pnr}} cancelled. Refund of {{refund}} initiated. Your other seats remain confirmed.'),
    (uuid_generate_v7(), v_tenant_id, 'booking.cancelled', 'email', 'Booking cancelled — PNR {{pnr}}', 'Your booking {{pnr}} has been cancelled. Refund: {{refundAmount}}.'),
    (uuid_generate_v7(), v_tenant_id, 'refund.settled', 'sms', NULL, 'Refund of {{refundAmount}} for PNR {{pnr}} has been processed.'),
    (uuid_generate_v7(), v_tenant_id, 'trip.delayed', 'sms', NULL, 'Your trip (PNR {{pnr}}) is delayed. New departure: {{newTime}}.'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.12h', 'sms', NULL, 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Have a safe journey!'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.12h', 'whatsapp', NULL, 'Hi! Your trip {{pnr}} is coming up.

Boarding: {{fromStopName}}, around {{boardingAt}}
Alighting: {{toStopName}}, around {{droppingAt}}
Passenger(s): {{passengerNames}}

We will send your exact pickup point and bus details 4 hours before boarding.'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.12h', 'email', 'Your upcoming trip — PNR {{pnr}}', 'Your trip is coming up.

PNR: {{pnr}}
Boarding: {{fromStopName}} (around {{boardingAt}})
Alighting: {{toStopName}} (around {{droppingAt}})
Passenger(s): {{passengerNames}}

We will send your exact pickup point, driver and bus details 4 hours before boarding.'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'sms', NULL, 'Boarding in 4h — PNR {{pnr}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Track live: {{trackingUrl}}'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'whatsapp', NULL, 'Your bus boards in 4 hours! PNR {{pnr}}

Pickup: {{pickup.stopName}}
{{pickup.landmark}}
{{pickup.address}}

Bus number: {{busNumber}}
Driver(s): {{driversList}}
Attendant(s): {{attendantsList}}

Track live location: {{trackingUrl}}

Please reach 15 minutes early.'),
    (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'email', 'Boarding in 4 hours — PNR {{pnr}}', 'Your bus boards in 4 hours.

Pickup point: {{pickup.stopName}}
Landmark: {{pickup.landmark}}
Address: {{pickup.address}}

Bus number: {{busNumber}}
Driver(s): {{driversList}}
Attendant(s): {{attendantsList}}

Track live location: {{trackingUrl}}

Please reach your pickup point 15 minutes early.'),
    (uuid_generate_v7(), v_tenant_id, 'connection.at_risk', 'sms', NULL, 'Your connecting bus (PNR {{pnr}}) is running {{delayMinutes}} min late. Only {{marginMinutes}} min margin left for your next bus. We are monitoring this for you.'),
    (uuid_generate_v7(), v_tenant_id, 'connection.broken', 'sms', NULL, 'Your connecting bus (PNR {{pnr}}) is delayed by {{delayMinutes}} min and may miss your next connection. Please contact support for help rebooking.'),
    (uuid_generate_v7(), v_tenant_id, 'incident.critical', 'sms', NULL, 'EMERGENCY ({{type}}) reported on trip {{tripId}} at {{time}}. Location: {{location}}. {{description}} — acknowledge in the Ticketly console now.'),
    (uuid_generate_v7(), v_tenant_id, 'incident.critical', 'email', 'EMERGENCY: {{type}} reported — acknowledge now', 'An emergency ({{type}}) was reported at {{time}} on trip {{tripId}}.' || E'\n' || 'Location: {{location}}' || E'\n' || 'Details: {{description}}' || E'\n' || '' || E'\n' || 'Open the Ticketly console → Incidents to acknowledge it.'),
    (uuid_generate_v7(), v_tenant_id, 'waitlist.seats_available', 'sms', NULL, 'Good news! {{seatCount}} seat(s) just opened up on {{routeName}} ({{journeyDate}}). Book quickly — seats go to whoever books first: {{bookUrl}}'),
    (uuid_generate_v7(), v_tenant_id, 'waitlist.seats_available', 'email', 'Seats available: {{routeName}} on {{journeyDate}}', 'Seats you were waiting for have opened up on {{routeName}} ({{journeyDate}}).' || E'\n' || '' || E'\n' || 'This is not a reservation — the seats go to whoever books first.' || E'\n' || 'Book now: {{bookUrl}}')
  ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
  -- NOTE: this seed intentionally does NOT create the encrypted operator-admin
  -- user (email/phone here are the FieldEncryptor's job, same reason
  -- seed.ts's seedSuperAdmin() is TypeScript, not raw SQL) — create it with:
  --   npm run db:seed:demo-admin   (see the companion script + run-command)

  -- 3) Stops — origin, one intermediate (Alwar, roughly the highway
  -- midpoint), and destination.
  INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
  VALUES (uuid_generate_v7(), v_tenant_id, v_delhi_city, 'Kashmere Gate ISBT', 'both', 'Near Metro Gate 3', true)
  RETURNING id INTO v_stop_delhi;
  INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
  VALUES (uuid_generate_v7(), v_tenant_id, v_alwar_city, 'Alwar Bus Stand', 'both', 'Highway bypass junction', true)
  RETURNING id INTO v_stop_alwar;
  INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
  VALUES (uuid_generate_v7(), v_tenant_id, v_jaipur_city, 'Sindhi Camp Bus Stand', 'both', 'Opp. Railway Station', true)
  RETURNING id INTO v_stop_jaipur;

  -- 4) Route Delhi → Alwar → Jaipur, ~280km, ~5h30m
  INSERT INTO routes (id, tenant_id, code, name, origin_city_id, dest_city_id, status, total_distance_m, total_duration_min)
  VALUES (uuid_generate_v7(), v_tenant_id, 'DEL-JAI-01', 'Delhi → Jaipur', v_delhi_city, v_jaipur_city, 'published', 280000, 330)
  RETURNING id INTO v_route_id;

  INSERT INTO route_stops (id, tenant_id, route_id, stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight)
  VALUES
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_delhi, 0, 0, 0, 0, true, false),
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_alwar, 1, 150000, 175, 10, true, true),
    (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_jaipur, 2, 280000, 330, 0, false, true);

  -- 5) 2+2 seater layout, 10 rows = 40 seats (built programmatically —
  -- hand-writing 40 seat entries by hand is exactly the kind of thing that
  -- silently drifts from the validation rules; generate_series can't).
  WITH numbered AS (
    SELECT row_number() OVER (ORDER BY r, c) AS n, r, c
    FROM generate_series(0, 9) r, generate_series(0, 4) c
    WHERE c <> 2  -- column 2 is the aisle — no seat there
  )
  SELECT jsonb_agg(jsonb_build_object('number', n::text, 'deck', 0, 'row', r, 'column', c, 'type', 'seater'))
    INTO v_seats FROM numbered;

  INSERT INTO seat_layouts (id, tenant_id, name, decks, total_seats, seater_count, sleeper_count, layout, is_active)
  VALUES (uuid_generate_v7(), v_tenant_id, '2+2 Seater (40)', 1, 40, 40, 0,
          jsonb_build_object('decks', 1, 'rows', 10, 'columns', 5, 'seats', v_seats), true)
  RETURNING id INTO v_layout_id;

  -- 6) Vehicle type + one vehicle
  INSERT INTO vehicle_types (id, tenant_id, name, code, is_ac, seat_layout_id, is_active)
  VALUES (uuid_generate_v7(), v_tenant_id, 'AC Seater 2+2', 'AC-2X2', true, v_layout_id, true)
  RETURNING id INTO v_vtype_id;

  -- Seeded as already platform-verified (migration 0050): the service below
  -- uses it as its default bus, which the DB refuses for an unverified bus.
  INSERT INTO vehicles (id, tenant_id, registration_no, vehicle_type_id, seat_layout_id, status,
                        make, model, manufacture_year, chassis_no, engine_no, fuel_type, registered_owner, has_ac,
                        verification_status, verification_reason, submitted_at, verified_at)
  VALUES (uuid_generate_v7(), v_tenant_id, 'RJ14PA1234', v_vtype_id, v_layout_id, 'active',
          'Volvo', '9600', 2022, 'MAT448123K1A12345', 'ENGD13K440123', 'diesel', 'Demo Travels Pvt Ltd', true,
          'approved', 'Seed: verified demo bus', now() - interval '30 days', now() - interval '29 days')
  RETURNING id INTO v_vehicle_id;

  -- 7) Fare plan — flat ₹850 seater fare, Delhi → Jaipur
  INSERT INTO fare_plans (id, tenant_id, route_id, name, currency, status, effective_from)
  VALUES (uuid_generate_v7(), v_tenant_id, v_route_id, 'Standard fares', 'INR', 'active', current_date)
  RETURNING id INTO v_fare_plan_id;

  INSERT INTO fare_rules (id, tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor)
  VALUES (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, v_stop_delhi, v_stop_jaipur, 'seater', 85000);

  -- 8) Daily service, origin departs 21:30 (1290 min), for the next 90 days —
  -- draft the SERVICE only; materialise trips via the app (see file header).
  INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, default_vehicle_id, start_minute, recurrence, status)
  VALUES (
    uuid_generate_v7(), v_tenant_id, 'DEL-JAI-2130', v_route_id, v_vtype_id, v_vehicle_id, 1290,
    jsonb_build_object('frequency', 'daily', 'startDate', to_char(current_date, 'YYYY-MM-DD'), 'endDate', to_char(current_date + interval '90 days', 'YYYY-MM-DD')),
    'active'
  );

  -- Crew — one driver, one conductor (matches this seed's single-vehicle scale).
  INSERT INTO crew (id, tenant_id, role, full_name, phone, status, licence_no, licence_expires_on, employee_code)
  VALUES (uuid_generate_v7(), v_tenant_id, 'driver', 'Ramesh Kumar', '+919811111111', 'active', 'DL-DEMO001', current_date + interval '2 years', 'DRV-DEMO-1');
  INSERT INTO crew (id, tenant_id, role, full_name, phone, status, employee_code)
  VALUES (uuid_generate_v7(), v_tenant_id, 'conductor', 'Suresh Yadav', '+919822222222', 'active', 'CND-DEMO-1');

  RAISE NOTICE 'Demo Travels seeded — tenant_id=%, route_id=%. Now: 1) create the operator-admin login (see companion script), 2) materialise trips via POST /v1/scheduling/services/:id/materialise', v_tenant_id, v_route_id;
END $$;
