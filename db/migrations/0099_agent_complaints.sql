-- migrate:up
-- 0099_agent_complaints
-- A formal complaint the operator records against one of its travel agents
-- (overcharging a passenger, a wrong booking, misbehaviour, suspected fraud),
-- optionally tied to the booking it is about. It is investigated and then
-- upheld or dismissed with what was decided; the agent's record keeps the
-- history, so repeat problems show when deciding on suspension or renewal.
CREATE TABLE agent_complaints (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('overcharging', 'wrong_booking', 'misbehaviour', 'fraud', 'other')),
  description   text NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  booking_id    uuid REFERENCES bookings(id),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  resolution    text CHECK (resolution IS NULL OR length(resolution) BETWEEN 5 AND 2000),
  raised_by     uuid REFERENCES users(id),
  resolved_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE INDEX agent_complaints_agent_idx ON agent_complaints (tenant_id, agent_id, created_at DESC);
SELECT apply_tenant_rls('agent_complaints');

-- migrate:down
DROP TABLE IF EXISTS agent_complaints;
