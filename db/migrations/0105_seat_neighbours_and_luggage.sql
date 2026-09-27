-- migrate:up
-- 0105_seat_neighbours_and_luggage
-- 1) Who may sit next to whom: an operator can keep the seat beside a woman
--    for women ('women'), or also the seat beside a man for men ('both').
-- 2) On the bus: the conductor counts each passenger's bags and writes the
--    tag numbers at check-in, and checks the passenger out at the drop point.
ALTER TABLE passenger_policies
  ADD COLUMN adjacent_seat_rule text NOT NULL DEFAULT 'off'
    CHECK (adjacent_seat_rule IN ('off', 'women', 'both'));

ALTER TABLE tickets
  ADD COLUMN luggage_count smallint NOT NULL DEFAULT 0 CHECK (luggage_count BETWEEN 0 AND 20),
  ADD COLUMN luggage_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN checked_out_at timestamptz,
  ADD CONSTRAINT tickets_luggage_tags_fit CHECK (cardinality(luggage_tags) <= luggage_count),
  ADD CONSTRAINT tickets_checkout_after_boarding CHECK (checked_out_at IS NULL OR boarded_at IS NOT NULL);

-- migrate:down
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS tickets_checkout_after_boarding,
  DROP CONSTRAINT IF EXISTS tickets_luggage_tags_fit,
  DROP COLUMN IF EXISTS checked_out_at,
  DROP COLUMN IF EXISTS luggage_tags,
  DROP COLUMN IF EXISTS luggage_count;
ALTER TABLE passenger_policies DROP COLUMN IF EXISTS adjacent_seat_rule;
