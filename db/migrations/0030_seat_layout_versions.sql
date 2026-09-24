-- =============================================================================
-- 0030_seat_layout_versions
--
-- Every save (create AND edit) of a seat layout snapshots the full layout
-- JSON here, numbered sequentially per layout. Nothing is ever deleted from
-- this table — editing a layout is common (a bus gets reconfigured, a seat
-- turns out to be broken) and a mistaken save should always be recoverable,
-- exactly like "version history" in a document editor.
-- =============================================================================

-- migrate:up

CREATE TABLE seat_layout_versions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seat_layout_id  uuid NOT NULL REFERENCES seat_layouts(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  name            text NOT NULL,
  layout          jsonb NOT NULL,
  changed_by      uuid REFERENCES users(id),
  change_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seat_layout_id, version_number)
);
CREATE INDEX seat_layout_versions_layout_idx ON seat_layout_versions (seat_layout_id, version_number DESC);
SELECT apply_tenant_rls('seat_layout_versions');

-- migrate:down

DROP TABLE IF EXISTS seat_layout_versions;
