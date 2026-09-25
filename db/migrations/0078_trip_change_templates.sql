-- =============================================================================
-- 0078_trip_change_templates
--
-- Passengers are now told when their trip is re-timed or diverted (#274,
-- #275). Every existing operator gets the two SMS templates new operators are
-- provisioned with (an operator's own edits are never overwritten).
-- =============================================================================

-- migrate:up
INSERT INTO notification_templates (tenant_id, event_type, channel, subject, body)
SELECT t.id, v.event_type, 'sms', NULL, v.body
  FROM tenants t
 CROSS JOIN (VALUES
   ('trip.retimed', 'Schedule change for PNR {{pnr}}: your bus now departs at {{newTime}} (was {{oldTime}}). {{reason}}'),
   ('trip.diverted', 'Route change for PNR {{pnr}}: your bus is taking a diversion. {{reason}} We will keep you updated.')
 ) AS v(event_type, body)
 WHERE t.deleted_at IS NULL
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

-- migrate:down
DELETE FROM notification_templates WHERE event_type IN ('trip.retimed', 'trip.diverted');
