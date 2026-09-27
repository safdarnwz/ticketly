-- =============================================================================
-- 0106_journey_reminders_8h_4h_1h
--
-- Journey-day reminders move from 12h + 4h to 8h + 4h + 1h before boarding,
-- each by SMS, WhatsApp and email:
--   8h  — the trip picture (PNR, passengers, boarding/dropping times);
--   4h  — pickup point, bus number, every driver (one to three) and the
--         conductor / attendants with their mobiles, and the tracking link;
--   1h  — the last reminder, same details; the bus is live on the map now.
--
-- The 12h "sent" flag becomes the 8h one (a booking already reminded at 12h
-- is not reminded again at 8h), a 1h flag is added, the operators' 12h
-- templates become 8h ones, untouched default wording moves to the new
-- wording (an operator's own text is kept), and every operator gets the
-- 1h templates.
-- =============================================================================

-- migrate:up

ALTER TABLE bookings RENAME COLUMN reminder_12h_sent_at TO reminder_8h_sent_at;
ALTER TABLE bookings ADD COLUMN reminder_1h_sent_at timestamptz;

UPDATE notification_templates SET event_type = 'trip.reminder.8h' WHERE event_type = 'trip.reminder.12h';

UPDATE notification_templates SET subject = NULL, body = 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Live tracking link with driver details comes 4 hours before boarding.'
 WHERE event_type = 'trip.reminder.8h' AND channel = 'sms'
   AND body IN ('Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Have a safe journey!');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.8h', 'sms', NULL, 'Reminder: your trip {{pnr}} boards at {{fromStopName}} around {{boardingAt}}, alights at {{toStopName}}. Live tracking link with driver details comes 4 hours before boarding.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
UPDATE notification_templates SET subject = NULL, body = 'Hi! Your trip *{{pnr}}* is today.' || E'\n' || '' || E'\n' || 'Boarding: *{{fromStopName}}*, around {{boardingAt}}' || E'\n' || 'Alighting: *{{toStopName}}*, around {{droppingAt}}' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.'
 WHERE event_type = 'trip.reminder.8h' AND channel = 'whatsapp'
   AND body IN ('Hi! Your trip *{{pnr}}* is coming up.' || E'\n' || '' || E'\n' || 'Boarding: *{{fromStopName}}*, around {{boardingAt}}' || E'\n' || 'Alighting: *{{toStopName}}*, around {{droppingAt}}' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point and bus details 4 hours before boarding.',
                'Hi! Your trip {{pnr}} is coming up.' || E'\n' || '' || E'\n' || 'Boarding: {{fromStopName}}, around {{boardingAt}}' || E'\n' || 'Alighting: {{toStopName}}, around {{droppingAt}}' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point and bus details 4 hours before boarding.');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.8h', 'whatsapp', NULL, 'Hi! Your trip *{{pnr}}* is today.' || E'\n' || '' || E'\n' || 'Boarding: *{{fromStopName}}*, around {{boardingAt}}' || E'\n' || 'Alighting: *{{toStopName}}*, around {{droppingAt}}' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
UPDATE notification_templates SET subject = 'Your journey today — PNR {{pnr}}', body = 'Your journey is today.' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Boarding: {{fromStopName}} (around {{boardingAt}})' || E'\n' || 'Alighting: {{toStopName}} (around {{droppingAt}})' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.'
 WHERE event_type = 'trip.reminder.8h' AND channel = 'email'
   AND body IN ('Your trip is coming up.' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Boarding: {{fromStopName}} (around {{boardingAt}})' || E'\n' || 'Alighting: {{toStopName}} (around {{droppingAt}})' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point, driver and bus details 4 hours before boarding.');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.8h', 'email', 'Your journey today — PNR {{pnr}}', 'Your journey is today.' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Boarding: {{fromStopName}} (around {{boardingAt}})' || E'\n' || 'Alighting: {{toStopName}} (around {{droppingAt}})' || E'\n' || 'Passenger(s): {{passengerNames}}' || E'\n' || '' || E'\n' || 'We will send your exact pickup point, bus number, driver and crew details and the live-tracking link 4 hours before boarding.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
UPDATE notification_templates SET subject = NULL, body = 'Boarding in 4h — PNR {{pnr}}, {{boardingAt}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track (live from {{trackingStartsAt}}): {{trackingUrl}}'
 WHERE event_type = 'trip.reminder.4h' AND channel = 'sms'
   AND body IN ('Boarding in 4h — PNR {{pnr}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Track live: {{trackingUrl}}');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.4h', 'sms', NULL, 'Boarding in 4h — PNR {{pnr}}, {{boardingAt}}. Pickup: {{pickup.stopName}} ({{pickup.landmark}}). Bus {{busNumber}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track (live from {{trackingStartsAt}}): {{trackingUrl}}' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
UPDATE notification_templates SET subject = NULL, body = 'Your bus boards in 4 hours! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '{{pickup.address}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track your bus: {{trackingUrl}}' || E'\n' || '(The bus shows on the map from {{trackingStartsAt}}.)' || E'\n' || '' || E'\n' || 'Please reach 15 minutes early.'
 WHERE event_type = 'trip.reminder.4h' AND channel = 'whatsapp'
   AND body IN ('Your bus boards in 4 hours! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*' || E'\n' || '{{pickup.landmark}}' || E'\n' || '{{pickup.address}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track live location: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please reach 15 minutes early.',
                'Your bus boards in 4 hours! PNR {{pnr}}' || E'\n' || '' || E'\n' || 'Pickup: {{pickup.stopName}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '{{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Driver(s): {{driversList}}' || E'\n' || 'Attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || 'Track live location: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please reach 15 minutes early.');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.4h', 'whatsapp', NULL, 'Your bus boards in 4 hours! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '{{pickup.address}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track your bus: {{trackingUrl}}' || E'\n' || '(The bus shows on the map from {{trackingStartsAt}}.)' || E'\n' || '' || E'\n' || 'Please reach 15 minutes early.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
UPDATE notification_templates SET subject = 'Boarding in 4 hours — PNR {{pnr}}', body = 'Your bus boards in 4 hours, at {{boardingAt}}.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Track your bus: {{trackingUrl}}' || E'\n' || 'The bus shows on the map from {{trackingStartsAt}}, one hour before departure.' || E'\n' || '' || E'\n' || 'Please reach your pickup point 15 minutes early.'
 WHERE event_type = 'trip.reminder.4h' AND channel = 'email'
   AND body IN ('Your bus boards in 4 hours.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Driver(s): {{driversList}}' || E'\n' || 'Attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || 'Track live location: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please reach your pickup point 15 minutes early.');
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.4h', 'email', 'Boarding in 4 hours — PNR {{pnr}}', 'Your bus boards in 4 hours, at {{boardingAt}}.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Track your bus: {{trackingUrl}}' || E'\n' || 'The bus shows on the map from {{trackingStartsAt}}, one hour before departure.' || E'\n' || '' || E'\n' || 'Please reach your pickup point 15 minutes early.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.1h', 'sms', NULL, 'Last reminder: PNR {{pnr}} boards at {{boardingAt}} from {{pickup.stopName}}. Bus {{busNumber}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track live now: {{trackingUrl}}' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.1h', 'whatsapp', NULL, 'Last reminder — your bus boards in 1 hour! *{{pnr}}*' || E'\n' || '' || E'\n' || '📍 Pickup: *{{pickup.stopName}}*, {{boardingAt}}' || E'\n' || '{{pickup.landmark}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Your bus is live now: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please be at the pickup point 15 minutes early.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.reminder.1h', 'email', 'Last reminder: boarding in 1 hour — PNR {{pnr}}', 'Your bus boards in 1 hour, at {{boardingAt}}.' || E'\n' || '' || E'\n' || 'Pickup point: {{pickup.stopName}}' || E'\n' || 'Landmark: {{pickup.landmark}}' || E'\n' || 'Address: {{pickup.address}}' || E'\n' || '' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Your bus is live on the map now: {{trackingUrl}}' || E'\n' || '' || E'\n' || 'Please be at your pickup point 15 minutes early.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

-- migrate:down

DELETE FROM notification_templates WHERE event_type = 'trip.reminder.1h';
UPDATE notification_templates SET event_type = 'trip.reminder.12h' WHERE event_type = 'trip.reminder.8h';
ALTER TABLE bookings DROP COLUMN IF EXISTS reminder_1h_sent_at;
ALTER TABLE bookings RENAME COLUMN reminder_8h_sent_at TO reminder_12h_sent_at;
