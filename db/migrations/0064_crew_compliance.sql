-- =============================================================================
-- 0064_crew_compliance
-- Operator-configurable crew rest rules, manager-approved exceptions
-- ("double duty") recorded with the exact rules they broke, and attendance.
-- =============================================================================

-- migrate:up
CREATE TABLE crew_rest_rules (
  tenant_id                        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  min_rest_minutes                 integer NOT NULL CHECK (min_rest_minutes BETWEEN 60 AND 1440),
  max_daily_driving_minutes        integer NOT NULL CHECK (max_daily_driving_minutes BETWEEN 60 AND 1440),
  max_duty_minutes                 integer NOT NULL CHECK (max_duty_minutes BETWEEN 60 AND 1440),
  max_continuous_driving_minutes   integer CHECK (max_continuous_driving_minutes IS NULL OR max_continuous_driving_minutes BETWEEN 60 AND 1440),
  updated_by                       uuid REFERENCES users(id),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('crew_rest_rules');

ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS override_reason text;
ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS override_conflicts jsonb;
ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS attendance text NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending', 'present', 'late', 'absent'));
ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS reported_at timestamptz;
ALTER TABLE crew_duties ADD COLUMN IF NOT EXISTS attendance_marked_by uuid REFERENCES users(id);
ALTER TABLE crew_duties ADD CONSTRAINT crew_duties_override_needs_reason CHECK (override_conflicts IS NULL OR length(coalesce(override_reason, '')) >= 10);

-- migrate:down
ALTER TABLE crew_duties DROP CONSTRAINT IF EXISTS crew_duties_override_needs_reason;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS attendance_marked_by;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS reported_at;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS attendance;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS approved_by;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS override_conflicts;
ALTER TABLE crew_duties DROP COLUMN IF EXISTS override_reason;
DROP TABLE IF EXISTS crew_rest_rules;
