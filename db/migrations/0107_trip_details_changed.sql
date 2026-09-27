-- =============================================================================
-- 0107_trip_details_changed
--
-- The trip decides its bus and crew, and either may change late — a bus
-- breaks down and another takes its place, a driver is swapped. A passenger
-- who already got the 4-hour reminder (bus number, drivers and crew with
-- their mobiles) is then sent the new details once. journey_details_hash
-- records what they were last told so the same details are never re-sent.
-- =============================================================================

-- migrate:up

ALTER TABLE bookings ADD COLUMN journey_details_hash text;

INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.details_changed', 'sms', NULL, 'Update for PNR {{pnr}}: {{changeNote}} Bus {{busNumber}}, seat(s) {{seats}}, boarding {{boardingAt}}. Driver(s): {{driversList}}. Crew: {{attendantsList}}. Track: {{trackingUrl}}' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.details_changed', 'whatsapp', NULL, 'Update for your trip *{{pnr}}*' || E'\n' || '' || E'\n' || '{{changeNote}}' || E'\n' || '' || E'\n' || '🚌 Bus number: *{{busNumber}}*' || E'\n' || '💺 Seat(s): *{{seats}}*' || E'\n' || '📍 Pickup: {{pickup.stopName}}, {{boardingAt}}' || E'\n' || '👨‍✈️ Driver(s): {{driversList}}' || E'\n' || '🧑‍💼 Conductor / attendant(s): {{attendantsList}}' || E'\n' || '' || E'\n' || '📍 Track your bus: {{trackingUrl}}' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'trip.details_changed', 'email', 'Your bus or crew has changed — PNR {{pnr}}', '{{changeNote}}' || E'\n' || '' || E'\n' || 'PNR: {{pnr}}' || E'\n' || 'Bus number: {{busNumber}}' || E'\n' || 'Seat(s): {{seats}}' || E'\n' || 'Pickup: {{pickup.stopName}}, {{boardingAt}}' || E'\n' || '' || E'\n' || 'Your crew:' || E'\n' || '{{crewList}}' || E'\n' || '' || E'\n' || 'Track your bus: {{trackingUrl}}' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

-- migrate:down

DELETE FROM notification_templates WHERE event_type = 'trip.details_changed';
ALTER TABLE bookings DROP COLUMN IF EXISTS journey_details_hash;
