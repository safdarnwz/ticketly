-- migrate:up
-- 0098_support_escalation
-- Operator staff escalate a ticket they cannot solve (a technical fault, a
-- payment the gateway lost) to the platform's own support team. The
-- escalation has its own small life on the ticket — open (waiting on the
-- platform) → answered (the platform replied) → closed (the platform is done) —
-- independent of the ticket's customer-facing status. The notes exchanged are
-- support_messages with author_kind 'escalation' (operator → platform) or
-- 'platform' (platform → operator); customers never see them.
ALTER TABLE support_tickets
  ADD COLUMN escalation_status    text CHECK (escalation_status IN ('open', 'answered', 'closed')),
  ADD COLUMN escalated_at         timestamptz,
  ADD COLUMN escalated_by         uuid REFERENCES users(id),
  ADD COLUMN escalation_closed_at timestamptz;

CREATE INDEX support_tickets_escalated_idx
  ON support_tickets (escalation_status, escalated_at DESC) WHERE escalation_status IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS support_tickets_escalated_idx;
ALTER TABLE support_tickets
  DROP COLUMN IF EXISTS escalation_closed_at,
  DROP COLUMN IF EXISTS escalated_by,
  DROP COLUMN IF EXISTS escalated_at,
  DROP COLUMN IF EXISTS escalation_status;
