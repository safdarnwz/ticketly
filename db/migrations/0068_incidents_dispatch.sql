-- =============================================================================
-- 0068_incidents_dispatch
-- Operational incidents (SOS, medical, security, accident, breakdown,
-- diversion, delay with category, on-board complaint), lost & found register,
-- shift handover notes, and actual departure/arrival times for on-time
-- performance reporting.
-- =============================================================================

-- migrate:up
ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_departed_at timestamptz;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_arrived_at timestamptz;

CREATE TABLE incidents (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id          uuid REFERENCES trips(id) ON DELETE SET NULL,
  type             text NOT NULL CHECK (type IN ('sos','medical','security','accident','breakdown','diversion','delay','complaint','other')),
  severity         text NOT NULL CHECK (severity IN ('critical','high','normal')),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','closed')),
  description      text,
  lat              double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng              double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  delay_category   text,
  delay_minutes    integer,
  diversion_via    text,
  reported_by      uuid REFERENCES users(id),
  acknowledged_by  uuid REFERENCES users(id),
  acknowledged_at  timestamptz,
  resolved_by      uuid REFERENCES users(id),
  resolved_at      timestamptz,
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_open_idx ON incidents (tenant_id, severity, created_at) WHERE status IN ('open','acknowledged');
CREATE INDEX incidents_trip_idx ON incidents (trip_id);
SELECT apply_tenant_rls('incidents');

CREATE TABLE lost_found_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id         uuid REFERENCES trips(id) ON DELETE SET NULL,
  description     text NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
  seat_number     text,
  stored_at       text,
  status          text NOT NULL DEFAULT 'found' CHECK (status IN ('found','claimed','disposed')),
  found_by        uuid REFERENCES users(id),
  found_at        timestamptz NOT NULL DEFAULT now(),
  claimant_name   text,
  claim_pnr       text,
  claimed_at      timestamptz,
  handed_by       uuid REFERENCES users(id),
  disposed_at     timestamptz
);
CREATE INDEX lost_found_open_idx ON lost_found_items (tenant_id, found_at DESC) WHERE status = 'found';
SELECT apply_tenant_rls('lost_found_items');

CREATE TABLE shift_notes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope       text NOT NULL CHECK (scope IN ('dispatch','branch')),
  branch_id   uuid REFERENCES branches(id),
  note        text NOT NULL CHECK (length(note) BETWEEN 2 AND 4000),
  written_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_notes_idx ON shift_notes (tenant_id, scope, created_at DESC);
SELECT apply_tenant_rls('shift_notes');

-- Emergency alert templates for every EXISTING operator (new operators get them
-- from onboarding defaults; seeds insert their own).
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'incident.critical', 'sms', NULL, 'EMERGENCY ({{type}}) reported on trip {{tripId}} at {{time}}. Location: {{location}}. {{description}} — acknowledge in the Ticketly console now.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;
INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
SELECT uuid_generate_v7(), t.id, 'incident.critical', 'email', 'EMERGENCY: {{type}} reported — acknowledge now', 'An emergency ({{type}}) was reported at {{time}} on trip {{tripId}}.' || E'\n' || 'Location: {{location}}' || E'\n' || 'Details: {{description}}' || E'\n' || '' || E'\n' || 'Open the Ticketly console → Incidents to acknowledge it.' FROM tenants t
ON CONFLICT (tenant_id, event_type, channel) DO NOTHING;

-- migrate:down
DELETE FROM notification_templates WHERE event_type = 'incident.critical';
DROP TABLE IF EXISTS shift_notes;
DROP TABLE IF EXISTS lost_found_items;
DROP TABLE IF EXISTS incidents;
ALTER TABLE trips DROP COLUMN IF EXISTS actual_arrived_at;
ALTER TABLE trips DROP COLUMN IF EXISTS actual_departed_at;
