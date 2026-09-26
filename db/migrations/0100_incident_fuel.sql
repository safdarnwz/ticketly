-- migrate:up
-- 0100_incident_fuel
-- A fuel problem (running low with no pump ahead, wrong fuel, a leak) is its own
-- incident type: dispatch arranges fuel or a relief bus, so it is high priority.
ALTER TABLE incidents DROP CONSTRAINT incidents_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_type_check CHECK (type IN
  ('sos', 'medical', 'security', 'accident', 'breakdown', 'fuel', 'diversion', 'delay', 'complaint', 'other'));

-- migrate:down
UPDATE incidents SET type = 'other' WHERE type = 'fuel';
ALTER TABLE incidents DROP CONSTRAINT incidents_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_type_check CHECK (type IN
  ('sos', 'medical', 'security', 'accident', 'breakdown', 'diversion', 'delay', 'complaint', 'other'));
