-- =============================================================================
-- 0009_liveops_notifications
--
-- GPS telemetry (partitioned, high-throughput), live trip state, and the
-- notification engine (templates + a delivery log). The outbox dispatcher and
-- schedulers (worker) operate over the outbox_events table from Part 1 and the
-- tables here.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- gps_pings — raw vehicle telemetry. This is the highest-write-rate table in
-- the platform (a fleet of 500 buses at 1 ping/5s ≈ 100 writes/s sustained,
-- far more during peak). It is therefore:
--   * partitioned by day (append-only; old partitions dropped, never DELETEd);
--   * indexed only by (trip, recorded_at) — the one query the live map needs;
--   * NOT row-level-security'd per-row on the hot path — instead it inherits
--     tenant scope via trip_id and a lightweight policy, because per-ping RLS
--     overhead at this write rate is not worth it and the data is low-
--     sensitivity (a bus location).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE gps_pings (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id     uuid NOT NULL,
  trip_id       uuid NOT NULL,
  vehicle_id    uuid,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  speed_kmph    real NOT NULL DEFAULT 0,
  heading_deg   real,
  distance_covered_m integer NOT NULL DEFAULT 0,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX gps_pings_trip_idx ON gps_pings (trip_id, recorded_at DESC);
CREATE TABLE gps_pings_default PARTITION OF gps_pings DEFAULT;

CREATE OR REPLACE FUNCTION ensure_gps_partitions(days_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d date; nxt date; part text; i integer;
BEGIN
  FOR i IN 0..days_ahead LOOP
    d := (current_date + (i || ' days')::interval)::date;
    nxt := (d + 1)::date;
    part := format('gps_pings_%s', to_char(d, 'YYYY_MM_DD'));
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF gps_pings FOR VALUES FROM (%L) TO (%L)', part, d, nxt);
    END IF;
  END LOOP;
END; $$;
SELECT ensure_gps_partitions(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- trip_live — the current live state of a trip, updated from the latest ping.
-- One row per trip; this is what the live map and "where is my bus" API read,
-- so it is a cheap single-row lookup rather than an aggregate over gps_pings.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trip_live (
  trip_id           uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lat               double precision,
  lng               double precision,
  speed_kmph        real NOT NULL DEFAULT 0,
  distance_covered_m integer NOT NULL DEFAULT 0,
  next_stop_id      uuid,
  next_stop_eta_at  timestamptz,
  delay_minutes     integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'not_started', -- 'not_started'|'running'|'arrived'|'completed'
  last_ping_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trip_live_updated_at BEFORE UPDATE ON trip_live FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- notification_templates — per-tenant message templates by event + channel.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notification_templates (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type    text NOT NULL,               -- 'booking.confirmed'
  channel       text NOT NULL,               -- 'sms'|'email'|'whatsapp'|'push'
  subject       text,
  body          text NOT NULL,               -- with {{placeholders}}
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_type, channel)
);
CREATE TRIGGER notification_templates_updated_at BEFORE UPDATE ON notification_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications — the delivery log. One row per message dispatched, with status
-- and provider response. Deduplicated on (event, channel, recipient) so a
-- retried outbox delivery never double-sends.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      uuid,                        -- the outbox event that triggered it
  channel       text NOT NULL,
  recipient     text NOT NULL,
  subject       text,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending', -- 'pending'|'sent'|'failed'
  provider      text,
  provider_ref  text,
  attempts      smallint NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, channel, recipient)
);
CREATE INDEX notifications_status_idx ON notifications (status, created_at) WHERE status = 'pending';

SELECT apply_tenant_rls('trip_live');
SELECT apply_tenant_rls('notification_templates');
SELECT apply_tenant_rls('notifications');

-- gps_pings: lightweight tenant policy (see comment above).
ALTER TABLE gps_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_pings FORCE ROW LEVEL SECURITY;
CREATE POLICY gps_pings_policy ON gps_pings
  USING (rls_bypass_enabled() OR tenant_id IS NOT DISTINCT FROM current_tenant_id())
  WITH CHECK (rls_bypass_enabled() OR tenant_id IS NOT DISTINCT FROM current_tenant_id());

-- migrate:down

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS trip_live;
DROP FUNCTION IF EXISTS ensure_gps_partitions(integer);
DROP TABLE IF EXISTS gps_pings;
