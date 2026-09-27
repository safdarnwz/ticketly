-- =============================================================================
-- multi-operator.seed.sql
--
-- 10 fully-onboarded, active operators, each with a DIFFERENT fleet size (all
-- under 50 buses, per spec) and a MIX of vehicle types (Seater/Sleeper/
-- Semi-sleeper, AC/non-AC). Each operator gets one route + one daily service.
-- ALSO seeds a handful of standalone operator_applications still sitting in
-- the onboarding QUEUE (pending / rejected) with no tenant provisioned yet —
-- so the platform admin's onboarding-review screen has real pending/rejected
-- rows to act on, not just a permanently-empty queue. Trip MATERIALISATION
-- (creating the actual bookable trip rows with correct inventory bitmaps)
-- is deliberately left to the app's own materialise endpoint — see the
-- companion script `scripts/generate-bookings.ts`, which boots the real
-- NestJS app context and calls the REAL SchedulingService/BookingService/
-- PaymentService/RefundService for everything past this point. Hand-crafting
-- 3000 bookings' worth of ledger entries in raw SQL would be exactly the
-- kind of thing that quietly stops balancing — this seed only goes as far
-- as raw SQL can go safely (routes, fleets, layouts), and the real app code
-- takes over for anything involving money or seat inventory.
--
-- Run once, AFTER geography.seed.sql and `npm run db:seed`:
--   npm run db:seed:multi-operator
-- Then: npm run db:seed:operator-admins   (creates each operator's login)
-- Then: npm run generate:bookings         (materialises trips + 3000 bookings)
-- =============================================================================

DO $$
DECLARE
  -- code, name, fleet_size, ac_seater_count, sleeper_count, semi_count, seater_count
  op record;
  operators text[][] := ARRAY[
    ['orange-travels',    'Orange Travels Pvt Ltd',        '20'],
    ['bluebird-express',  'Bluebird Express',              '30'],
    ['sharma-tours',      'Sharma Tours & Travels',        '5'],
    ['single-coach',      'Single Coach Yatra',            '1'],
    ['royal-cruiser',     'Royal Cruiser Lines',           '7'],
    ['himgiri-roadways',  'Himgiri Roadways',              '15'],
    ['veerabhadra-travels','Veerabhadra Travels',          '25'],
    ['tripura-express',   'Tripura Express Pvt Ltd',       '3'],
    ['maharaja-yatra',    'Maharaja Yatra Bus Service',    '40'],
    ['golden-arrow',      'Golden Arrow Travels',          '10']
  ];
  v_tenant_id uuid;
  v_app_id uuid;
  v_delhi uuid; v_jaipur uuid; v_bangalore uuid; v_mysuru uuid; v_alwar uuid; v_channapatna uuid;
  v_origin_city uuid; v_dest_city uuid; v_mid_city uuid; v_origin_name text; v_dest_name text; v_mid_name text;
  v_stop_origin uuid; v_stop_dest uuid; v_stop_mid uuid;
  v_route_id uuid;
  v_layout_seater uuid; v_layout_sleeper uuid; v_layout_semi uuid;
  v_vtype_seater uuid; v_vtype_sleeper uuid; v_vtype_semi uuid;
  v_fare_plan_id uuid;
  v_operator_role_id uuid;
  v_seats_seater jsonb; v_seats_sleeper jsonb; v_seats_semi jsonb;
  fleet_size int;
  i int;
  v_reg_prefix text;
  v_vtype_id uuid;
  v_layout_id uuid;
  v_driver_id uuid;
  v_conductor_id uuid;
  v_this_vehicle_id uuid;
  v_vstatus text;
  v_reg text;
  v_file_id uuid;
  v_key text;
  v_doc record;
  v_amenity_wifi uuid;
  v_amenity_charging uuid;
  v_amenity_blanket uuid;
  v_amenity_water uuid;
  v_branch_id uuid;
  v_manager_user_id uuid;
  v_webhook_id uuid;
  driver_count int;
  crew_status_pick crew_status;
BEGIN
  SELECT id INTO v_delhi FROM cities WHERE name = 'Delhi' LIMIT 1;
  SELECT id INTO v_jaipur FROM cities WHERE name = 'Jaipur' LIMIT 1;
  SELECT id INTO v_bangalore FROM cities WHERE name = 'Bangalore' LIMIT 1;
  SELECT id INTO v_mysuru FROM cities WHERE name = 'Mysuru' LIMIT 1;
  SELECT id INTO v_alwar FROM cities WHERE name = 'Alwar' LIMIT 1;
  SELECT id INTO v_channapatna FROM cities WHERE name = 'Channapatna' LIMIT 1;
  IF v_delhi IS NULL OR v_jaipur IS NULL OR v_bangalore IS NULL OR v_mysuru IS NULL OR v_alwar IS NULL OR v_channapatna IS NULL THEN
    RAISE EXCEPTION 'Cities not found — run geography.seed.sql first';
  END IF;

  -- Build the two seat-layout shapes ONCE (reused across every operator —
  -- the ACTUAL layout content doesn't need to differ per-operator, only the
  -- vehicle rows referencing them do).
  WITH numbered AS (
    SELECT row_number() OVER (ORDER BY r, c) AS n, r, c
    FROM generate_series(0, 9) r, generate_series(0, 4) c WHERE c <> 2
  )
  SELECT jsonb_agg(jsonb_build_object('number', n::text, 'deck', 0, 'row', r, 'column', c, 'type', 'seater'))
    INTO v_seats_seater FROM numbered;

  WITH numbered AS (
    SELECT row_number() OVER (ORDER BY r, c) AS n, r, c
    FROM generate_series(0, 8) r, generate_series(0, 2) c WHERE c <> 1
  )
  SELECT jsonb_agg(jsonb_build_object('number', ('L' || n)::text, 'deck', 0, 'row', r, 'column', c, 'type', 'sleeper'))
    INTO v_seats_sleeper FROM numbered;

  WITH numbered AS (
    SELECT row_number() OVER (ORDER BY r, c) AS n, r, c
    FROM generate_series(0, 7) r, generate_series(0, 3) c WHERE c <> 2
  )
  SELECT jsonb_agg(jsonb_build_object('number', n::text, 'deck', 0, 'row', r, 'column', c, 'type', 'semi_sleeper'))
    INTO v_seats_semi FROM numbered;

  FOR i IN 1..array_length(operators, 1) LOOP
    fleet_size := operators[i][3]::int;

    -- Alternate the route between Delhi-Jaipur and Bangalore-Mysuru pairs so
    -- both an inter-state (IGST) and intra-state (CGST+SGST) GST path get
    -- real booking volume, not just one.
    IF i % 2 = 0 THEN
      v_origin_city := v_bangalore; v_dest_city := v_mysuru; v_mid_city := v_channapatna;
      v_origin_name := 'Majestic Bus Stand'; v_dest_name := 'Mysuru City Bus Stand'; v_mid_name := 'Channapatna Bus Stand';
    ELSE
      v_origin_city := v_delhi; v_dest_city := v_jaipur; v_mid_city := v_alwar;
      v_origin_name := 'Kashmere Gate ISBT'; v_dest_name := 'Sindhi Camp Bus Stand'; v_mid_name := 'Alwar Bus Stand';
    END IF;

    INSERT INTO tenants (id, slug, legal_name, display_name, status, contact_email, contact_phone, gstin, registered_address,
                          bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_details_updated_at)
    VALUES (uuid_generate_v7(), operators[i][1], operators[i][2], operators[i][2], 'active',
            'ops@' || operators[i][1] || '.example', '+9198' || lpad(i::text, 8, '0'),
            lpad((20+i)::text, 2, '0') || 'AAAAA' || lpad(i::text, 4, '0') || 'A1Z' || (i%10),
            'Transport Nagar, Depot ' || i,
            -- Bank details, on file from day one (mirrors what onboarding
            -- approval requires in the real flow) — without these, an
            -- operator's settlement can generate/finalise but there is
            -- nothing for the payout bank-file to actually pay out TO,
            -- which is not how a real operator's account ever looks.
            operators[i][2], lpad((100000000000 + i * 7)::text, 15, '0'), 'HDFC000' || lpad(i::text, 4, '0'), 'HDFC Bank', now())
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_tenant_id;
    IF v_tenant_id IS NULL THEN
      SELECT id INTO v_tenant_id FROM tenants WHERE slug = operators[i][1];
      CONTINUE; -- already seeded on a previous run — skip to the next operator
    END IF;

    -- Clone the platform's operator_admin role template into this tenant.
    INSERT INTO roles (id, tenant_id, code, name, description, is_system)
    SELECT uuid_generate_v7(), v_tenant_id, code, name, description, is_system
      FROM roles WHERE tenant_id IS NULL AND code = 'operator_admin'
    RETURNING id INTO v_operator_role_id;
    INSERT INTO role_permissions (role_id, permission)
    SELECT v_operator_role_id, permission FROM role_permissions
     WHERE role_id = (SELECT id FROM roles WHERE tenant_id IS NULL AND code = 'operator_admin' LIMIT 1)
    ON CONFLICT DO NOTHING;

    -- Default notification templates — WITHOUT these, NotificationService.
    -- notify() silently sends nothing for this tenant forever (looks up a
    -- template by tenant+eventType, skips the whole event if none exists,
    -- no error). Mirrors the same defaults OnboardingService.approve() now
    -- seeds for a real operator — this raw-SQL seed bypasses that code
    -- path, so it needs its own copy.
    INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body) VALUES
      (uuid_generate_v7(), v_tenant_id, 'booking.confirmed', 'sms', NULL, 'Booking confirmed! PNR {{pnr}}. Have a safe journey.'),
      (uuid_generate_v7(), v_tenant_id, 'booking.confirmed', 'email', 'Your ticket — PNR {{pnr}}', 'Your booking is confirmed. PNR: {{pnr}}.'),
      (uuid_generate_v7(), v_tenant_id, 'booking.cancelled', 'sms', NULL, 'Booking {{pnr}} cancelled. Refund of {{refundAmount}} initiated.'),
      (uuid_generate_v7(), v_tenant_id, 'booking.seats_cancelled', 'sms', NULL, 'Seat(s) {{seats}} on booking {{pnr}} cancelled. Refund of {{refund}} initiated. Your other seats remain confirmed.'),
      (uuid_generate_v7(), v_tenant_id, 'booking.cancelled', 'email', 'Booking cancelled — PNR {{pnr}}', 'Your booking {{pnr}} has been cancelled. Refund: {{refundAmount}}.'),
      (uuid_generate_v7(), v_tenant_id, 'refund.settled', 'sms', NULL, 'Refund of {{refundAmount}} for PNR {{pnr}} has been processed.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.delayed', 'sms', NULL, 'Your trip (PNR {{pnr}}) is delayed. New departure: {{newTime}}.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.retimed', 'sms', NULL, 'Schedule change for PNR {{pnr}}: your bus now departs at {{newTime}} (was {{oldTime}}). {{reason}}'),
      (uuid_generate_v7(), v_tenant_id, 'trip.diverted', 'sms', NULL, 'Route change for PNR {{pnr}}: your bus is taking a diversion. {{reason}} We will keep you updated.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.8h', 'sms', NULL, 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Live tracking link with driver details comes 4 hours before boarding.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.8h', 'whatsapp', NULL, 'Hi! Your trip *{{pnr}}* is today.' || E'\n' || '' || E'\n' || 'Boarding: *{{fromStopName}}*, around {{boardingAt}}' || E'\n' || 'Alighting: *{{toStopName}}*, around {{droppingAt}}' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.8h', 'email', 'Your journey today — PNR {{pnr}}', 'Your journey is today.' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Boarding: {{fromStopName}} (around {{boardingAt}})' || E'\n' || 'Alighting: {{toStopName}} (around {{droppingAt}})' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'sms', NULL, 'Boarding in 4h — PNR {{pnr}}, {{boardingAt}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}, seat(s) {{seats}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track (live from {{trackingStartsAt}}): {{trackingUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'whatsapp', NULL, 'Your bus boards in 4 hours! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '{{pickup.address}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '💺 Seat(s): *{{seats}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track your bus: {{trackingUrl}}' || E'\n' || '(The bus shows on the map from {{trackingStartsAt}}.)' || E'\n' || '' || E'\n' || 'Please reach 15 minutes early.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.4h', 'email', 'Boarding in 4 hours — PNR {{pnr}}', 'Your bus boards in 4 hours, at {{boardingAt}}.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Seat(s): {{seats}}' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Track your bus: {{trackingUrl}}' || E'\n' || 'The bus shows on the map from {{trackingStartsAt}}, one hour before departure.' || E'\n' || '' || E'\n' || 'Please reach your pickup point 15 minutes early.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.1h', 'sms', NULL, 'Last reminder: PNR {{pnr}} boards at {{boardingAt}} from {{pickup.stopName}}. Bus {{busNumber}}, seat(s) {{seats}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track live now: {{trackingUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.1h', 'whatsapp', NULL, 'Last reminder — your bus boards in 1 hour! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '💺 Seat(s): *{{seats}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Your bus is live now: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please be at the pickup point 15 minutes early.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.reminder.1h', 'email', 'Last reminder: boarding in 1 hour — PNR {{pnr}}', 'Your bus boards in 1 hour, at {{boardingAt}}.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Seat(s): {{seats}}' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Your bus is live on the map now: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please be at your pickup point 15 minutes early.'),
      (uuid_generate_v7(), v_tenant_id, 'trip.details_changed', 'sms', NULL, 'Update for PNR {{pnr}}: {{changeNote}} Bus {{busNumber}}, seat(s) {{seats}}, boarding {{boardingAt}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track: {{trackingUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'trip.details_changed', 'whatsapp', NULL, 'Update for your trip *{{pnr}}*' || E'\n' || '' || E'\n' || '{{changeNote}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '💺 Seat(s): *{{seats}}*' || E'\n' || '📍 Pickup: {{pickup.stopName}}, {{boardingAt}}' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track your bus: {{trackingUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'trip.details_changed', 'email', 'Your bus or crew has changed — PNR {{pnr}}', '{{changeNote}}' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Seat(s): {{seats}}' || E'\n' || 'Pickup: {{pickup.stopName}}, {{boardingAt}}' || E'\n' || '' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Track your bus: {{trackingUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'connection.at_risk', 'sms', NULL, 'Your connecting bus (PNR {{pnr}}) is running {{delayMinutes}} min late. Only {{marginMinutes}} min margin left for your next bus. We are monitoring this for you.'),
      (uuid_generate_v7(), v_tenant_id, 'connection.broken', 'sms', NULL, 'Your connecting bus (PNR {{pnr}}) is delayed by {{delayMinutes}} min and may miss your next connection. Please contact support for help rebooking.'),
      (uuid_generate_v7(), v_tenant_id, 'incident.critical', 'sms', NULL, 'EMERGENCY ({{type}}) reported on trip {{tripId}} at {{time}}. Location: {{location}}. {{description}} — acknowledge in the Ticketly console now.'),
      (uuid_generate_v7(), v_tenant_id, 'incident.critical', 'email', 'EMERGENCY: {{type}} reported — acknowledge now', 'An emergency ({{type}}) was reported at {{time}} on trip {{tripId}}.' || E'\n' || 'Location: {{location}}' || E'\n' || 'Details: {{description}}' || E'\n' || '' || E'\n' || 'Open the Ticketly console → Incidents to acknowledge it.'),
      (uuid_generate_v7(), v_tenant_id, 'waitlist.seats_available', 'sms', NULL, 'Good news! {{seatCount}} seat(s) just opened up on {{routeName}} ({{journeyDate}}). Book quickly — seats go to whoever books first: {{bookUrl}}'),
      (uuid_generate_v7(), v_tenant_id, 'waitlist.seats_available', 'email', 'Seats available: {{routeName}} on {{journeyDate}}', 'Seats you were waiting for have opened up on {{routeName}} ({{journeyDate}}).' || E'\n' || '' || E'\n' || 'This is not a reservation — the seats go to whoever books first.' || E'\n' || 'Book now: {{bookUrl}}')
    ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

    -- Stops — origin, ONE intermediate (a realistic route always has at
    -- least one midway boarding/dropping point), and destination.
    INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, v_origin_city, v_origin_name, 'both', 'Main terminus', true)
    RETURNING id INTO v_stop_origin;
    INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, v_mid_city, v_mid_name, 'both', 'Highway bypass junction', true)
    RETURNING id INTO v_stop_mid;
    INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, v_dest_city, v_dest_name, 'both', 'Main terminus', true)
    RETURNING id INTO v_stop_dest;

    -- Route — total ~280km / 330min; the intermediate stop sits at roughly
    -- the halfway point of BOTH distance and time (a simplification, but a
    -- consistent and realistic one — Alwar/Channapatna are genuinely close
    -- to the midpoint of their respective real highways).
    INSERT INTO routes (id, tenant_id, code, name, origin_city_id, dest_city_id, status, total_distance_m, total_duration_min)
    VALUES (uuid_generate_v7(), v_tenant_id, upper(left(operators[i][1], 3)) || '-01', v_origin_name || ' → ' || v_dest_name,
            v_origin_city, v_dest_city, 'published', 280000, 330)
    RETURNING id INTO v_route_id;
    INSERT INTO route_stops (id, tenant_id, route_id, stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight)
    VALUES
      (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_origin, 0, 0, 0, 0, true, false),
      (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_mid, 1, 150000, 175, 10, true, true),
      (uuid_generate_v7(), v_tenant_id, v_route_id, v_stop_dest, 2, 280000, 330, 0, false, true);

    -- Three seat-layouts (seater / sleeper / semi-sleeper) — every operator
    -- gets all three shapes available, per spec ("har tarah ke bus").
    INSERT INTO seat_layouts (id, tenant_id, name, decks, total_seats, seater_count, sleeper_count, layout, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, '2+2 AC Seater (40)', 1, 40, 40, 0, jsonb_build_object('decks', 1, 'rows', 10, 'columns', 5, 'seats', v_seats_seater), true)
    RETURNING id INTO v_layout_seater;
    INSERT INTO seat_layouts (id, tenant_id, name, decks, total_seats, seater_count, sleeper_count, layout, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, '1+1 AC Sleeper (18)', 1, 18, 0, 18, jsonb_build_object('decks', 1, 'rows', 9, 'columns', 3, 'seats', v_seats_sleeper), true)
    RETURNING id INTO v_layout_sleeper;
    INSERT INTO seat_layouts (id, tenant_id, name, decks, total_seats, seater_count, sleeper_count, layout, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, '2+1 Semi-Sleeper (24)', 1, 24, 0, 0, jsonb_build_object('decks', 1, 'rows', 8, 'columns', 4, 'seats', v_seats_semi), true)
    RETURNING id INTO v_layout_semi;

    INSERT INTO vehicle_types (id, tenant_id, name, code, is_ac, seat_layout_id, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, 'AC Seater 2+2', 'ACS', true, v_layout_seater, true) RETURNING id INTO v_vtype_seater;
    INSERT INTO vehicle_types (id, tenant_id, name, code, is_ac, seat_layout_id, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, 'AC Sleeper 1+1', 'ACSL', true, v_layout_sleeper, true) RETURNING id INTO v_vtype_sleeper;
    INSERT INTO vehicle_types (id, tenant_id, name, code, is_ac, seat_layout_id, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, 'Non-AC Semi-Sleeper', 'NACSS', false, v_layout_semi, true) RETURNING id INTO v_vtype_semi;

    -- Vehicles — split the fleet roughly across the three types (at least 1
    -- of each where the fleet is big enough; a 1-bus operator just gets one
    -- seater, which is realistic for a tiny single-coach operator).
    v_reg_prefix := upper(left(operators[i][1], 2)) || lpad(i::text, 2, '0');
    FOR j IN 1..fleet_size LOOP
      v_vtype_id := CASE WHEN fleet_size = 1 THEN v_vtype_seater
                          WHEN j % 3 = 0 THEN v_vtype_sleeper
                          WHEN j % 3 = 1 THEN v_vtype_seater
                          ELSE v_vtype_semi END;
      v_layout_id := CASE WHEN v_vtype_id = v_vtype_sleeper THEN v_layout_sleeper
                           WHEN v_vtype_id = v_vtype_semi THEN v_layout_semi
                           ELSE v_layout_seater END;
      -- Verification mix (migration 0050): most buses are platform-verified;
      -- a few sit in each other state so every admin/operator screen has
      -- real rows: submitted (review queue), rejected (with reason),
      -- suspended (expired PUC — the j % 11 buses below).
      v_vstatus := CASE WHEN j % 11 = 0 THEN 'suspended'
                        WHEN j % 13 = 0 THEN 'submitted'
                        WHEN j % 17 = 0 THEN 'rejected'
                        ELSE 'approved' END;
      v_reg := v_reg_prefix || 'AA' || lpad(j::text, 4, '0');
      INSERT INTO vehicles (id, tenant_id, registration_no, vehicle_type_id, seat_layout_id, status,
                            make, model, manufacture_year, chassis_no, engine_no, fuel_type, body_color, registered_owner,
                            registration_state, registration_date, has_ac,
                            verification_status, verification_reason, submitted_at, verified_at)
      VALUES (uuid_generate_v7(), v_tenant_id, v_reg, v_vtype_id, v_layout_id,
              CASE WHEN v_vstatus = 'approved' THEN 'active' ELSE 'maintenance' END::vehicle_status,
              (ARRAY['Volvo', 'Ashok Leyland', 'Tata', 'BharatBenz', 'Eicher'])[1 + j % 5],
              (ARRAY['9600', 'Viking', 'Starbus', '1624', 'Skyline'])[1 + j % 5],
              2018 + j % 7,
              'MAT' || upper(left(md5(v_reg), 6)) || 'A' || lpad((i * 100 + j)::text, 7, '0'),
              'ENG' || upper(left(md5(v_reg || 'e'), 9)),
              CASE WHEN j % 9 = 0 THEN 'cng' ELSE 'diesel' END,
              (ARRAY['White', 'Blue', 'Orange', 'Silver'])[1 + j % 4],
              operators[i][2], 'India', current_date - (400 + j * 30), v_vtype_id <> v_vtype_seater,
              v_vstatus,
              CASE v_vstatus WHEN 'rejected' THEN 'Insurance copy is unreadable — please upload a clear scan'
                             WHEN 'suspended' THEN 'Automatically suspended: Expired: Pollution Under Control (PUC)'
                             ELSE NULL END,
              now() - interval '20 days',
              CASE WHEN v_vstatus IN ('approved', 'suspended') THEN now() - interval '18 days' ELSE NULL END)
      RETURNING id INTO v_this_vehicle_id;

      -- Per-bus platform fee — every vehicle onboarded owes this once
      -- (platform_charges_dedupe_idx enforces exactly once per vehicle).
      INSERT INTO platform_charges (id, tenant_id, kind, reference_type, reference_id, amount_minor, status)
      VALUES (uuid_generate_v7(), v_tenant_id, 'per_bus_fee', 'vehicle', v_this_vehicle_id, 50000, 'pending');

      -- Compliance documents — permit/insurance/fitness/PUC per Motor
      -- Vehicles Act 1988 requirements. A couple of vehicles get an
      -- EXPIRED PUC on purpose (j % 11 = 0) — a fleet with zero compliance
      -- issues ever is not a realistic fleet, and the Fleet page's
      -- expiry-warning UI has nothing to show against an always-clean list.
      -- All six documents the platform requires, each backed by a real
      -- (tiny) PDF in stored_files on the 'database' provider, so "Open"
      -- works in dev. To move these to R2: npm run storage:migrate.
      FOR v_doc IN SELECT * FROM (VALUES
          ('rc', v_reg, '2019-01-01'::date, current_date + interval '8 years', 'RTO'),
          ('permit', 'PMT-' || i || '-' || j, '2024-01-01'::date, current_date + interval '18 months', 'RTO'),
          ('insurance', 'INS-' || i || '-' || j, '2025-04-01'::date, current_date + interval '6 months', 'National Insurance Co.'),
          ('fitness', 'FIT-' || i || '-' || j, '2024-06-01'::date, current_date + interval '12 months', 'RTO'),
          ('puc', 'PUC-' || i || '-' || j, '2026-06-01'::date,
             CASE WHEN j % 11 = 0 THEN current_date - interval '5 days' ELSE current_date + interval '3 months' END, 'Authorised PUC Centre'),
          ('road_tax', 'TAX-' || i || '-' || j, '2025-04-01'::date, current_date + interval '10 months', 'State Transport Dept')
        ) AS d(doc_type, doc_no, valid_from, expires_on, issuer)
      LOOP
        v_file_id := uuid_generate_v7();
        v_key := operators[i][1] || '/vehicles/' || v_reg || '/' || v_doc.doc_type || '/' || v_file_id || '.pdf';
        INSERT INTO stored_files (id, tenant_id, purpose, provider, bucket, object_key, visibility, file_name, mime_type, size_bytes, sha256)
        VALUES (v_file_id, v_tenant_id, 'vehicle_document', 'database', '', v_key, 'private', v_doc.doc_type || '.pdf',
                'application/pdf', 399, 'c559ef91b0accf66a3689e889b84b35b9026a4eff42bc9fd8de1642d5d7478bb');
        INSERT INTO stored_file_blobs (object_key, tenant_id, content, content_type)
        VALUES (v_key, v_tenant_id, decode('JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDE0NF0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNTg+PnN0cmVhbQpCVCAvRjEgMTQgVGYgMjAgNzAgVGQgKFRpY2tldGx5IHNlZWQgZG9jdW1lbnQpIFRqIEVUCmVuZHN0cmVhbSBlbmRvYmoKNSAwIG9iajw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK', 'base64'), 'application/pdf');
        INSERT INTO vehicle_documents (id, tenant_id, vehicle_id, doc_type, document_no, valid_from, expires_on, issuer, file_id,
                                       verification_status, rejection_reason, verified_at)
        VALUES (uuid_generate_v7(), v_tenant_id, v_this_vehicle_id, v_doc.doc_type, v_doc.doc_no, v_doc.valid_from, v_doc.expires_on,
                v_doc.issuer, v_file_id,
                CASE WHEN v_vstatus = 'submitted' THEN 'pending'
                     WHEN v_vstatus = 'rejected' AND v_doc.doc_type = 'insurance' THEN 'rejected'
                     WHEN v_vstatus = 'draft' THEN 'pending'
                     ELSE 'verified' END,
                CASE WHEN v_vstatus = 'rejected' AND v_doc.doc_type = 'insurance' THEN 'Scan is unreadable — upload a clear copy' END,
                CASE WHEN v_vstatus IN ('approved', 'suspended', 'rejected') THEN now() - interval '18 days' END);
      END LOOP;

      -- Maintenance + fuel history — a couple of realistic past entries.
      INSERT INTO maintenance_logs (id, tenant_id, vehicle_id, kind, description, odometer_km, cost_minor, performed_on, next_due_on) VALUES
        (uuid_generate_v7(), v_tenant_id, v_this_vehicle_id, 'service', 'Periodic service — oil, filters, brake check', 45000 + j * 137, 350000, current_date - interval '45 days', current_date + interval '45 days');
      INSERT INTO fuel_logs (id, tenant_id, vehicle_id, litres, cost_minor, odometer_km, filled_on) VALUES
        (uuid_generate_v7(), v_tenant_id, v_this_vehicle_id, 180.5, 1650000, 45000 + j * 137 + 800, current_date - interval '2 days');
    END LOOP;

    -- Fare plan — seater/sleeper/semi all priced off the SAME route.
    INSERT INTO fare_plans (id, tenant_id, route_id, name, currency, status, effective_from)
    VALUES (uuid_generate_v7(), v_tenant_id, v_route_id, 'Standard fares', 'INR', 'active', '2026-09-01')
    RETURNING id INTO v_fare_plan_id;
    INSERT INTO fare_rules (id, tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor) VALUES
      (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, v_stop_origin, v_stop_dest, 'seater', 85000),
      (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, v_stop_origin, v_stop_dest, 'sleeper', 140000),
      (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, v_stop_origin, v_stop_dest, 'semi_sleeper', 110000);

    -- Daily service, 21:30 departure, Sept 1 through 60 days out — trip
    -- MATERIALISATION happens via the app (generate-bookings.ts), not here.
    -- THREE services — one per vehicle-type, staggered departures on the
    -- SAME route. Without this, the sleeper/semi-sleeper buses just sit in
    -- the fleet never actually running a trip — every vehicle-type built
    -- above needs a service that actually uses it, or "har tarah ke bus"
    -- is true of the fleet table but not of anything a customer can book.
    INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, start_minute, recurrence, status) VALUES
      (uuid_generate_v7(), v_tenant_id, upper(left(operators[i][1], 3)) || '-SEATER', v_route_id, v_vtype_seater, 1230,  -- 20:30
       jsonb_build_object('frequency', 'daily', 'startDate', '2026-09-01', 'endDate', to_char(current_date + interval '60 days', 'YYYY-MM-DD')), 'active'),
      (uuid_generate_v7(), v_tenant_id, upper(left(operators[i][1], 3)) || '-SLEEPER', v_route_id, v_vtype_sleeper, 1290,  -- 21:30
       jsonb_build_object('frequency', 'daily', 'startDate', '2026-09-01', 'endDate', to_char(current_date + interval '60 days', 'YYYY-MM-DD')), 'active'),
      (uuid_generate_v7(), v_tenant_id, upper(left(operators[i][1], 3)) || '-SEMI', v_route_id, v_vtype_semi, 1320,  -- 22:00
       jsonb_build_object('frequency', 'daily', 'startDate', '2026-09-01', 'endDate', to_char(current_date + interval '60 days', 'YYYY-MM-DD')), 'active');

    -- Custom cancellation policy for every 3rd operator — showing the
    -- feature is actually exercised, not just present as an unused column.
    -- The rest stay on the platform default (refund_policy = NULL), which
    -- is itself the REALISTIC common case — most operators never touch it.
    IF i % 3 = 0 THEN
      UPDATE tenants SET refund_policy = jsonb_build_object(
        'tiers', jsonb_build_array(
          jsonb_build_object('minHoursBeforeDeparture', 48, 'refundPct', 95),
          jsonb_build_object('minHoursBeforeDeparture', 12, 'refundPct', 60),
          jsonb_build_object('minHoursBeforeDeparture', 4, 'refundPct', 25)
        ),
        'flatFeeMinor', 3000,
        'cutoffHours', 2
      ) WHERE id = v_tenant_id;
    END IF;

    RAISE NOTICE 'Seeded operator % (%) — % buses, tenant_id=%', i, operators[i][2], fleet_size, v_tenant_id;

    -- Orange Travels ALSO runs a Jaipur -> Bangalore route — this is the
    -- ONLY route in the whole seed that actually creates a connecting
    -- opportunity: Delhi->Jaipur (any Delhi-Jaipur operator) + this route
    -- connects at Jaipur, and this route + Bangalore->Mysuru (any
    -- Bangalore-Mysuru operator) connects at Bangalore. Without this,
    -- ConnectingSearchService would NEVER find a single result against
    -- this seed data — every OTHER operator's routes are confined to one
    -- of two entirely separate city-pairs that never meet.
    IF i = 1 THEN
      DECLARE
        v_stop_jaipur2 uuid; v_stop_blr2 uuid; v_route2_id uuid; v_fare_plan2_id uuid;
      BEGIN
        INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
        VALUES (uuid_generate_v7(), v_tenant_id, v_jaipur, 'Jaipur Bus Stand (Sindhi Camp)', 'both', 'Near Railway Station', true)
        RETURNING id INTO v_stop_jaipur2;
        INSERT INTO stops (id, tenant_id, city_id, name, kind, landmark, is_active)
        VALUES (uuid_generate_v7(), v_tenant_id, v_bangalore, 'Bangalore Majestic', 'both', 'Central Bus Stand', true)
        RETURNING id INTO v_stop_blr2;

        INSERT INTO routes (id, tenant_id, code, name, origin_city_id, dest_city_id, status, total_distance_m, total_duration_min)
        VALUES (uuid_generate_v7(), v_tenant_id, 'ORG-JAI-BLR', 'Jaipur → Bangalore', v_jaipur, v_bangalore, 'published', 1980000, 1320)
        RETURNING id INTO v_route2_id;
        INSERT INTO route_stops (id, tenant_id, route_id, stop_id, sequence, distance_from_origin_m, depart_offset_min, dwell_min, can_board, can_alight)
        VALUES
          (uuid_generate_v7(), v_tenant_id, v_route2_id, v_stop_jaipur2, 0, 0, 0, 0, true, false),
          (uuid_generate_v7(), v_tenant_id, v_route2_id, v_stop_blr2, 1, 1980000, 1320, 0, false, true);

        INSERT INTO fare_plans (id, tenant_id, route_id, name, currency, status, effective_from)
        VALUES (uuid_generate_v7(), v_tenant_id, v_route2_id, 'Standard fares', 'INR', 'active', '2026-09-01')
        RETURNING id INTO v_fare_plan2_id;
        INSERT INTO fare_rules (id, tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor) VALUES
          (uuid_generate_v7(), v_tenant_id, v_fare_plan2_id, v_stop_jaipur2, v_stop_blr2, 'seater', 180000);

        -- Departs 10:00 (600 min) — comfortably lands a 2-24h layover
        -- window against BOTH the Delhi-Jaipur services (arrive Jaipur
        -- ~05:30) and the Bangalore-Mysuru services on the OTHER end.
        INSERT INTO services (id, tenant_id, code, route_id, vehicle_type_id, start_minute, recurrence, status)
        VALUES (uuid_generate_v7(), v_tenant_id, 'ORG-JAI-BLR-SVC', v_route2_id, v_vtype_seater, 600,
                jsonb_build_object('frequency', 'daily', 'startDate', '2026-09-01', 'endDate', to_char(current_date + interval '60 days', 'YYYY-MM-DD')),
                'active');
      END;
    END IF;

    -- Crew — drivers get ~20% MORE headcount than the bus-count (rotation/
    -- leave coverage is realistic; a fleet can't run if every single driver
    -- must be on duty every single day with zero slack), conductors 1:1
    -- with buses. Roughly 1 in 8 crew is deliberately seeded 'on_leave' —
    -- this IS the actual, queryable answer to "kaun chhutti par hai": it's
    -- crew.status, not a separate concept.
    driver_count := greatest(1, ceil(fleet_size * 1.2)::int);
    FOR j IN 1..driver_count LOOP
      crew_status_pick := CASE WHEN j % 8 = 0 THEN 'on_leave' ELSE 'active' END;
      INSERT INTO crew (id, tenant_id, role, full_name, phone, status, licence_no, licence_expires_on, employee_code)
      VALUES (uuid_generate_v7(), v_tenant_id, 'driver', 'Driver ' || i || '-' || j,
              '+9197' || lpad((i*100+j)::text, 8, '0'), crew_status_pick,
              'DL-' || lpad(i::text,2,'0') || lpad(j::text,4,'0'), current_date + ((j % 24) + 6) * interval '30 days',
              'DRV-' || i || '-' || j)
      RETURNING id INTO v_driver_id;
    END LOOP;
    FOR j IN 1..fleet_size LOOP
      crew_status_pick := CASE WHEN j % 8 = 0 THEN 'on_leave' ELSE 'active' END;
      INSERT INTO crew (id, tenant_id, role, full_name, phone, status, employee_code)
      VALUES (uuid_generate_v7(), v_tenant_id, 'conductor', 'Conductor ' || i || '-' || j,
              '+9196' || lpad((i*100+j)::text, 8, '0'), crew_status_pick, 'CND-' || i || '-' || j)
      RETURNING id INTO v_conductor_id;
    END LOOP;

    -- Amenities — a realistic AC-bus amenity set, linked onto vehicle_types.
    INSERT INTO amenities (id, tenant_id, code, name, icon) VALUES
      (uuid_generate_v7(), v_tenant_id, 'wifi', 'WiFi', 'wifi') RETURNING id INTO v_amenity_wifi;
    INSERT INTO amenities (id, tenant_id, code, name, icon) VALUES
      (uuid_generate_v7(), v_tenant_id, 'charging', 'Charging Point', 'plug') RETURNING id INTO v_amenity_charging;
    INSERT INTO amenities (id, tenant_id, code, name, icon) VALUES
      (uuid_generate_v7(), v_tenant_id, 'blanket', 'Blanket', 'blanket') RETURNING id INTO v_amenity_blanket;
    INSERT INTO amenities (id, tenant_id, code, name, icon) VALUES
      (uuid_generate_v7(), v_tenant_id, 'water', 'Water Bottle', 'water') RETURNING id INTO v_amenity_water;
    UPDATE vehicle_types SET amenity_ids = ARRAY[v_amenity_wifi, v_amenity_charging, v_amenity_blanket, v_amenity_water]
     WHERE id = v_vtype_sleeper;
    UPDATE vehicle_types SET amenity_ids = ARRAY[v_amenity_wifi, v_amenity_charging]
     WHERE id = v_vtype_seater;

    -- Coupons — one always-on percentage code, one first-booking flat-off.
    INSERT INTO coupons (id, tenant_id, code, kind, value, max_discount_minor, min_fare_minor, valid_from, valid_to, max_redemptions, per_user_limit, first_booking_only, description) VALUES
      (uuid_generate_v7(), v_tenant_id, 'SAVE10', 'percent', 10, 20000, 30000, '2026-09-01', current_date + interval '90 days', 1000, 3, false, '10% off, up to ₹200'),
      (uuid_generate_v7(), v_tenant_id, 'FIRST100', 'flat', 10000, NULL, 50000, '2026-09-01', current_date + interval '180 days', NULL, 1, true, '₹100 off your first booking');

    -- Branches — a head-office + one counter branch (manager left unassigned
    -- here; seed-operator-admins.ts creates the actual staff login afterward).
    INSERT INTO branches (id, tenant_id, name, address, phone, status)
    VALUES (uuid_generate_v7(), v_tenant_id, operators[i][2] || ' — Head Office', 'Transport Nagar, Depot ' || i, '+9198' || lpad(i::text, 8, '0'), 'active')
    RETURNING id INTO v_branch_id;
    INSERT INTO branches (id, tenant_id, name, address, phone, status)
    VALUES (uuid_generate_v7(), v_tenant_id, operators[i][2] || ' — Counter 2', v_origin_name || ' counter', '+9198' || lpad((i+50)::text, 8, '0'), 'active');

    -- Per-seat fare override — a couple of premium front-row seats priced
    -- above the flat fare_rules rate (a real operator DOES do this).
    INSERT INTO seat_fare_overrides (id, tenant_id, fare_plan_id, seat_number, fare_minor) VALUES
      (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, '1', 95000),
      (uuid_generate_v7(), v_tenant_id, v_fare_plan_id, '2', 95000);

    -- Operator-application audit trail — this tenant DID come through the
    -- real approval flow conceptually; status='approved' with
    -- provisioned_tenant_id linking back closes the loop for anyone
    -- auditing how this operator got onto the platform. password_hash is a
    -- placeholder — nobody ever logs in against this row once approved,
    -- the real login is the users-table row seed-operator-admins.ts creates.
    INSERT INTO operator_applications (id, status, first_name, last_name, email, mobile, password_hash,
                                        company_name, gst_number, pan_number, address_line1, city, state, pin_code,
                                        business, reviewed_at, provisioned_tenant_id, pan_verification_status)
    VALUES (uuid_generate_v7(), 'approved', 'Operator', 'Admin', 'ops@' || operators[i][1] || '.example',
            '+9198' || lpad(i::text, 8, '0'), '$2b$10$placeholderPlaceholderPlaceholderPlaceholderu',
            operators[i][2], lpad((20+i)::text, 2, '0') || 'AAAAA' || lpad(i::text, 4, '0') || 'A1Z' || (i%10),
            -- 4th letter 'C' = company holder-type — matches KYC's own PAN-format rules (kyc/domain/pan.ts)
            'AAACT' || lpad(i::text, 4, '0') || 'C',
            'Transport Nagar, Depot ' || i, CASE WHEN i % 2 = 0 THEN 'Bangalore' ELSE 'Delhi' END, 'India', '110001',
            jsonb_build_object('numberOfBuses', fleet_size, 'busTypes', ARRAY['seater','sleeper','semi_sleeper'], 'yearsInBusiness', 3 + (i % 15)),
            now() - interval '30 days', v_tenant_id, 'verified')
    RETURNING id INTO v_app_id;

    -- One real kyc_verifications row per operator — the FREE, offline
    -- format-check path (no external credentials needed to seed this, unlike
    -- Digio's paid PAN-match/Aadhaar-OTP/bank-verify, which genuinely can't
    -- run without real API keys). Demonstrates the feature actually has
    -- data behind it, not just an unused table.
    INSERT INTO kyc_verifications (id, operator_application_id, document_type, status, provider, masked_number, verified_at)
    VALUES (uuid_generate_v7(), v_app_id, 'pan', 'verified', 'format_check', 'AAACT' || lpad(i::text, 4, '0') || 'C', now() - interval '30 days');

    -- One pending bank-change request — most operators' bank details are
    -- final (seeded straight onto tenants), but a REAL fleet always has a
    -- few requests genuinely awaiting super-admin review at any moment —
    -- an approval-queue seeded permanently empty is not a realistic queue.
    IF i % 4 = 0 THEN
      INSERT INTO bank_account_change_requests (id, tenant_id, account_holder, account_number, ifsc, bank_name, status, created_at)
      VALUES (uuid_generate_v7(), v_tenant_id, operators[i][2], lpad((200000000000 + i * 11)::text, 15, '0'), 'ICIC000' || lpad(i::text, 4, '0'), 'ICICI Bank', 'pending', now() - interval '2 days');
    END IF;

    -- A registered outbound webhook (the operator's own endpoint) + a short delivery log —
    -- a couple delivered cleanly, one failed-and-retrying, matching what a
    -- real integration's log looks like (never 100% clean, never 100% dead).
    INSERT INTO partner_webhooks (id, tenant_id, name, url, secret, event_types, is_active)
    VALUES (uuid_generate_v7(), v_tenant_id, 'ERP integration', 'https://erp.example/webhooks/ticketly', 'whsec_' || md5(v_tenant_id::text || 'x'),
            ARRAY['booking.confirmed', 'booking.cancelled'], true)
    RETURNING id INTO v_webhook_id;

    INSERT INTO webhook_deliveries (id, webhook_id, tenant_id, event_type, event_id, payload, status, attempts, response_status, delivered_at) VALUES
      (uuid_generate_v7(), v_webhook_id, v_tenant_id, 'booking.confirmed', uuid_generate_v7(), jsonb_build_object('demo', true), 'delivered', 1, 200, now() - interval '3 days'),
      (uuid_generate_v7(), v_webhook_id, v_tenant_id, 'booking.confirmed', uuid_generate_v7(), jsonb_build_object('demo', true), 'delivered', 1, 200, now() - interval '2 days');
    INSERT INTO webhook_deliveries (id, webhook_id, tenant_id, event_type, event_id, payload, status, attempts, response_status, last_error, next_attempt_at) VALUES
      (uuid_generate_v7(), v_webhook_id, v_tenant_id, 'booking.cancelled', uuid_generate_v7(), jsonb_build_object('demo', true), 'pending', 2, 503, 'Service Unavailable', now() + interval '10 minutes');

  END LOOP;
END $$;

-- =============================================================================
-- Onboarding QUEUE — applications that never became tenants.
--
-- Every operator above was seeded already 'approved' (the business is live,
-- selling tickets today). A real platform's onboarding inbox also always has
-- a few applications still IN FLIGHT — this is what gives the admin
-- console's "Pending applications" / "Rejected applications" screens actual
-- rows to show, instead of a permanently-empty queue that only ever looks
-- populated in a screenshot. No tenant, no fleet, no crew for these three —
-- that IS the point: a pending/rejected applicant has none of that yet.
-- =============================================================================
INSERT INTO operator_applications (id, status, first_name, last_name, email, mobile, password_hash,
                                    company_name, gst_number, pan_number, address_line1, city, state, pin_code,
                                    business, pan_verification_status, created_at)
VALUES
  -- Awaiting review — submitted recently, nobody has looked at it yet.
  (uuid_generate_v7(), 'pending', 'Ramesh', 'Iyer', 'ramesh@newhorizon-travels.example', '+919812340001',
   '$2b$10$placeholderPlaceholderPlaceholderPlaceholderu', 'New Horizon Travels', '29AAAAA0001A1Z5', 'AAACN0001C',
   'MG Road, Depot 1', 'Bangalore', 'Karnataka', '560001',
   jsonb_build_object('numberOfBuses', 6, 'busTypes', ARRAY['seater'], 'yearsInBusiness', 2),
   'pending', now() - interval '1 day'),
  -- Awaiting review — PAN format-checked OK already, still waiting on a human reviewer.
  (uuid_generate_v7(), 'pending', 'Sunita', 'Rao', 'sunita@shivshakti-yatra.example', '+919812340002',
   '$2b$10$placeholderPlaceholderPlaceholderPlaceholderu', 'Shivshakti Yatra', '27AAAAA0002A1Z5', 'AAACS0002C',
   'Station Road, Depot 2', 'Pune', 'Maharashtra', '411001',
   jsonb_build_object('numberOfBuses', 4, 'busTypes', ARRAY['sleeper'], 'yearsInBusiness', 1),
   'verified', now() - interval '4 days'),
  -- Rejected — PAN check itself failed, so the application never made it to fleet review.
  (uuid_generate_v7(), 'rejected', 'Anil', 'Kapoor', 'anil@fastline-travels.example', '+919812340003',
   '$2b$10$placeholderPlaceholderPlaceholderPlaceholderu', 'Fastline Travels', '06AAAAA0003A1Z5', 'AAACF0003C',
   'Ring Road, Depot 3', 'Chennai', 'Tamil Nadu', '600001',
   jsonb_build_object('numberOfBuses', 3, 'busTypes', ARRAY['seater'], 'yearsInBusiness', 1),
   'failed', now() - interval '10 days'),
  -- Rejected — PAN was fine; rejected on manual review instead (duplicate registration).
  (uuid_generate_v7(), 'rejected', 'Meena', 'Das', 'meena@quicktrip-roadways.example', '+919812340004',
   '$2b$10$placeholderPlaceholderPlaceholderPlaceholderu', 'Quicktrip Roadways', '19AAAAA0004A1Z5', 'AAACQ0004C',
   'Salt Lake, Depot 4', 'Kolkata', 'West Bengal', '700001',
   jsonb_build_object('numberOfBuses', 5, 'busTypes', ARRAY['seater', 'sleeper'], 'yearsInBusiness', 4),
   'verified', now() - interval '15 days');

-- Reviewed_at/rejection_reason set separately (both columns depend on the
-- application already existing, and rejection_reason only makes sense once
-- we know which two rows above are the rejected ones by email).
UPDATE operator_applications SET reviewed_at = now() - interval '9 days',
  rejection_reason = 'PAN verification failed — number does not match company records.'
  WHERE email = 'anil@fastline-travels.example';
UPDATE operator_applications SET reviewed_at = now() - interval '13 days',
  rejection_reason = 'Duplicate application — an approved operator already exists at this GSTIN.'
  WHERE email = 'meena@quicktrip-roadways.example';
