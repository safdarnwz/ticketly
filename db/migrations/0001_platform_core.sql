-- =============================================================================
-- 0001_platform_core
--
-- Extensions, shared conventions, and the two tables the platform layer itself
-- owns: the transactional outbox and the idempotency store.
--
-- CONVENTIONS ESTABLISHED HERE AND FOLLOWED BY EVERY LATER MIGRATION
--   * primary keys       : uuid, generated as UUID v7 (see uuid_generate_v7)
--   * money              : bigint minor units + a char(3) currency column
--   * timestamps         : timestamptz, always UTC
--   * journey dates      : date  (timezone-free calendar day)
--   * times of day       : smallint minutes-since-midnight (0..1439)
--   * every tenant table : tenant_id uuid NOT NULL + RLS policy
--   * every table        : created_at, updated_at, and (where applicable)
--                          deleted_at for soft deletes and version for
--                          optimistic locking
--   * naming             : snake_case, plural table names, singular columns
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────────────────────
-- pgcrypto  : gen_random_bytes() for the v7 generator, digest() for hashing
-- btree_gin : lets us combine a GIN index with plain scalar columns, which is
--             what makes "tenant_id + jsonb attribute" filters index-only
-- pg_trgm   : trigram search for stop/city autocomplete (Part 3)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────────────────────────────────
-- UUID v7 generator
--
-- Ids are normally minted in the application (so we know them before the
-- INSERT), but a DEFAULT is invaluable for seeds, manual fixes and any table
-- written by a trigger. Layout per RFC 9562:
--
--   bits  0- 47 : unix_ts_ms   (big-endian milliseconds)
--   bits 48- 51 : version = 7
--   bits 52- 63 : rand_a
--   bits 64- 65 : variant = 0b10
--   bits 66-127 : rand_b
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE sql
VOLATILE
PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1                       -- version nibble -> 0111 (7)
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'Time-ordered UUID v7. Preferred over gen_random_uuid() for primary keys: '
  'monotonic ids keep B-tree inserts on the right edge instead of scattering '
  'random writes across every leaf page.';

-- Recover the creation instant embedded in a v7 uuid.
CREATE OR REPLACE FUNCTION uuid_v7_timestamp(id uuid)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT to_timestamp(
    ('x' || substring(replace(id::text, '-', '') FROM 1 FOR 12))::bit(48)::bigint / 1000.0
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared trigger: keep updated_at honest
--
-- Application code sets updated_at too, but a trigger guarantees it even for
-- a manual UPDATE run during an incident — which is exactly when you most need
-- accurate audit timestamps.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant resolution for Row-Level Security
--
-- Reads the GUC the application sets on each connection (libs/database/
-- tenant-session.ts). Marked STABLE so the planner can evaluate it once per
-- statement rather than once per row — the difference between an index scan
-- and a sequential scan on large tables.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION rls_bypass_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), 'off') = 'on';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- outbox_events — the transactional outbox
--
-- Written in the SAME transaction as the state change it describes, so it is
-- impossible to confirm a booking without enqueueing its notifications, or to
-- notify about a booking that rolled back.
--
-- The worker (Part 9) claims batches with FOR UPDATE SKIP LOCKED, which lets N
-- workers drain the table concurrently without coordination and without ever
-- processing the same row twice.
--
-- Partitioned by month: the table is append-heavy and we drop old partitions
-- rather than running DELETEs that bloat the heap and starve autovacuum.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE outbox_status AS ENUM ('pending', 'processing', 'delivered', 'failed', 'dead');

CREATE TABLE outbox_events (
  id              uuid           NOT NULL DEFAULT uuid_generate_v7(),
  tenant_id       uuid,
  event_type      text           NOT NULL,
  event_version   smallint       NOT NULL DEFAULT 1,
  aggregate_type  text           NOT NULL,
  aggregate_id    text           NOT NULL,
  payload         jsonb          NOT NULL,
  correlation_id  text,
  status          outbox_status  NOT NULL DEFAULT 'pending',
  attempts        smallint       NOT NULL DEFAULT 0,
  last_error      text,
  available_at    timestamptz    NOT NULL DEFAULT now(),
  occurred_at     timestamptz    NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE outbox_events IS
  'Transactional outbox. Rows are inserted inside the business transaction and '
  'delivered at-least-once by the worker; every handler must be idempotent.';

-- The claim query is:
--   SELECT ... WHERE status = 'pending' AND available_at <= now()
--   ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT $1
-- A partial index on exactly that predicate keeps the index tiny (it only
-- contains the backlog, not the millions of delivered rows).
CREATE INDEX outbox_events_claim_idx
  ON outbox_events (available_at, id)
  WHERE status = 'pending';

CREATE INDEX outbox_events_retry_idx
  ON outbox_events (available_at)
  WHERE status = 'failed';

CREATE INDEX outbox_events_type_idx ON outbox_events (event_type, occurred_at DESC);
CREATE INDEX outbox_events_aggregate_idx ON outbox_events (aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX outbox_events_tenant_idx ON outbox_events (tenant_id, occurred_at DESC) WHERE tenant_id IS NOT NULL;

-- Bootstrap partitions. `ensure_outbox_partitions()` (below) is called monthly
-- by the scheduler so this never needs manual maintenance.
CREATE TABLE outbox_events_default PARTITION OF outbox_events DEFAULT;

CREATE OR REPLACE FUNCTION ensure_outbox_partitions(months_ahead integer DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  start_month date;
  next_month  date;
  part_name   text;
  i           integer;
BEGIN
  FOR i IN 0..months_ahead LOOP
    start_month := date_trunc('month', current_date + (i || ' months')::interval)::date;
    next_month  := (start_month + interval '1 month')::date;
    part_name   := format('outbox_events_%s', to_char(start_month, 'YYYY_MM'));

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF outbox_events FOR VALUES FROM (%L) TO (%L)',
        part_name, start_month, next_month
      );
    END IF;
  END LOOP;
END;
$$;

SELECT ensure_outbox_partitions(3);

-- ─────────────────────────────────────────────────────────────────────────────
-- idempotency_keys
--
-- Guarantees that a retried unsafe request returns the original response rather
-- than executing twice. Lives in Postgres, not Redis: it must be exactly as
-- durable as the booking it protects.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE idempotency_status AS ENUM ('in_progress', 'completed');

CREATE TABLE idempotency_keys (
  key             text                NOT NULL,
  tenant_id       uuid,
  user_id         uuid,
  fingerprint     text                NOT NULL,
  method          text                NOT NULL,
  path            text                NOT NULL,
  status          idempotency_status  NOT NULL DEFAULT 'in_progress',
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz         NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz         NOT NULL DEFAULT now() + interval '24 hours'
);

-- A NULL tenant_id must still collide with another NULL tenant_id (unauthenticated
-- public bookings). A plain UNIQUE treats NULLs as distinct, so we use the
-- Postgres 15+ NULLS NOT DISTINCT form.
CREATE UNIQUE INDEX idempotency_keys_pkey
  ON idempotency_keys (key, tenant_id) NULLS NOT DISTINCT;

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

COMMENT ON COLUMN idempotency_keys.fingerprint IS
  'sha256(method + path + body). A reused key with a different fingerprint is '
  'rejected with 422 rather than silently replaying an unrelated response.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Housekeeping helper used by the worker
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION purge_expired_idempotency_keys(batch_size integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  removed integer;
BEGIN
  WITH doomed AS (
    SELECT ctid FROM idempotency_keys WHERE expires_at < now() LIMIT batch_size
  )
  DELETE FROM idempotency_keys t USING doomed d WHERE t.ctid = d.ctid;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- migrate:down

DROP FUNCTION IF EXISTS purge_expired_idempotency_keys(integer);
DROP TABLE IF EXISTS idempotency_keys;
DROP TYPE IF EXISTS idempotency_status;
DROP FUNCTION IF EXISTS ensure_outbox_partitions(integer);
DROP TABLE IF EXISTS outbox_events;
DROP TYPE IF EXISTS outbox_status;
DROP FUNCTION IF EXISTS rls_bypass_enabled();
DROP FUNCTION IF EXISTS current_tenant_id();
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS uuid_v7_timestamp(uuid);
DROP FUNCTION IF EXISTS uuid_generate_v7();
