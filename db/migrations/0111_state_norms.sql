-- =============================================================================
-- 0111_state_norms
--
-- Government rules per state (liquor prohibition, smoking, tobacco, plastic…)
-- set by the platform admin. Every route that passes through a state carries
-- that state's rules: they are worked out from the route's stops, so an
-- operator cannot leave them off, and passengers see them under the seat map
-- with the operator's own policies.
--
-- Platform data, like states and cities: no tenant. Rules are switched off
-- (is_active = false) rather than deleted, so what a passenger was shown
-- stays traceable.
-- =============================================================================

-- migrate:up

CREATE TABLE state_norms (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  state_id    uuid NOT NULL REFERENCES states(id),
  category    text NOT NULL CHECK (category IN ('liquor', 'smoking', 'tobacco', 'plastic', 'pets', 'luggage', 'documents', 'other')),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 3 AND 500),
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX state_norms_title_key ON state_norms (state_id, lower(title));
CREATE INDEX state_norms_state_idx ON state_norms (state_id) WHERE is_active;

-- migrate:down

DROP TABLE IF EXISTS state_norms;
