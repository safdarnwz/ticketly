-- migrate:up
-- 0102_crew_login
-- A conductor or driver signs in to the crew app with their own login: the
-- operator gives a crew member a password, which creates a user (role 'crew',
-- crew-app permission only) linked here. The app then shows only that crew
-- member's own duties and trips.
INSERT INTO permissions (code, resource, action, description)
VALUES ('crew:app', 'crew', 'app', 'Crew app: own duties and the trips on them only')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE crew ADD COLUMN user_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX crew_user_uq ON crew (tenant_id, user_id) WHERE user_id IS NOT NULL;

-- Crew report a dirty bus or a fault to fix (not a breakdown) from the road.
ALTER TABLE incidents DROP CONSTRAINT incidents_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_type_check CHECK (type IN
  ('sos', 'medical', 'security', 'accident', 'breakdown', 'fuel', 'diversion', 'delay', 'complaint',
   'cleaning', 'maintenance', 'other'));

-- migrate:down
UPDATE incidents SET type = 'other' WHERE type IN ('cleaning', 'maintenance');
ALTER TABLE incidents DROP CONSTRAINT incidents_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_type_check CHECK (type IN
  ('sos', 'medical', 'security', 'accident', 'breakdown', 'fuel', 'diversion', 'delay', 'complaint', 'other'));
DROP INDEX IF EXISTS crew_user_uq;
ALTER TABLE crew DROP COLUMN IF EXISTS user_id;
