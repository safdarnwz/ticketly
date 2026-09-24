-- =============================================================================
-- 0065_staff_access_controls
-- Time-limited role grants, contractor access expiry, login time windows,
-- reporting manager, and immediate force-logout (tokens issued before
-- tokens_valid_after are refused on the next request).
-- =============================================================================

-- migrate:up
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_window jsonb
  CHECK (login_window IS NULL OR (login_window ? 'days' AND login_window ? 'startMinute' AND login_window ? 'endMinute'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;
ALTER TABLE users ADD CONSTRAINT users_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);

-- migrate:down
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_manager_not_self;
ALTER TABLE users DROP COLUMN IF EXISTS tokens_valid_after;
ALTER TABLE users DROP COLUMN IF EXISTS manager_id;
ALTER TABLE users DROP COLUMN IF EXISTS login_window;
ALTER TABLE users DROP COLUMN IF EXISTS access_expires_at;
ALTER TABLE user_roles DROP COLUMN IF EXISTS expires_at;
