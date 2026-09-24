-- =============================================================================
-- 0050_operator_review_and_vehicle_verification
--
-- 1. OPERATOR REVIEW — a super admin can approve, reject, or put an
--    application (back) to pending, ALWAYS with a reason, and every move is
--    kept in an append-only history (operator_application_events).
--
-- 2. VEHICLE VERIFICATION — a bus is no longer live the moment an operator
--    types it in. Lifecycle:
--        draft ──submit──▶ submitted ──approve──▶ approved ──suspend──▶ suspended
--          ▲                  │                      │                      │
--          └──── (fix) ◀── rejected ◀──reject────────┘      resubmit ◀──────┘
--    Only a super admin approves, and only when every required document is
--    uploaded, verified by the admin, and unexpired.
--
-- 3. DOCUMENTS are versioned (a renewal is a NEW row; the old verified one
--    keeps the bus compliant until it actually expires) and every one is
--    backed by an uploaded file in stored_files.
--
-- 4. IDENTITY IS IMMUTABLE — registration_no (and chassis_no once set) can
--    never change after insert, enforced by a trigger, whatever the app does.
--    A registration number is also unique across ALL operators: one physical
--    bus cannot be listed by two operators.
--
-- 5. DB-LEVEL GUARDS — an unverified bus cannot be set as a service's
--    default vehicle or assigned to a trip, whichever code path tries.
-- =============================================================================

-- migrate:up

-- ─── 1. Operator application review ─────────────────────────────────────────
ALTER TABLE operator_applications ADD COLUMN review_note text;
ALTER TABLE operator_applications ADD COLUMN reopened_count integer NOT NULL DEFAULT 0;

CREATE TABLE operator_application_events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  application_id   uuid NOT NULL REFERENCES operator_applications(id) ON DELETE CASCADE,
  from_status      operator_application_status,
  to_status        operator_application_status NOT NULL,
  reason           text,
  actor_id         uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_application_events_app_idx ON operator_application_events (application_id, created_at);

-- Every existing application gets its first history row, so no timeline starts empty.
INSERT INTO operator_application_events (application_id, from_status, to_status, reason, actor_id, created_at)
SELECT id, NULL, 'pending', 'Application submitted', NULL, created_at FROM operator_applications;
INSERT INTO operator_application_events (application_id, from_status, to_status, reason, actor_id, created_at)
SELECT id, 'pending', status, rejection_reason, reviewed_by, coalesce(reviewed_at, updated_at)
  FROM operator_applications WHERE status <> 'pending';

-- ─── 2. Object storage registry (provider-agnostic) ───────────────────────
-- The BYTES live in object storage (Cloudflare R2 in production; AWS S3 /
-- Azure Blob later). This table is the registry: WHERE each object lives
-- (provider + bucket + key) and WHAT it is (real type from magic bytes,
-- size, sha256). Because every row records its own provider, a migration
-- to another cloud can copy objects gradually and flip rows one by one —
-- reads always go to wherever that row says the object is.
--
-- Keys are human-meaningful and stable: {operator-slug}/{folder}/... — e.g.
--   orange-travels/branding/logo.svg
--   orange-travels/vehicles/MH12AB1234/insurance/<id>.pdf
-- A key is computed ONCE at upload and stored; an operator later changing
-- their slug never breaks a stored link.
CREATE TABLE stored_files (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- NULL = platform scope (operator APPLICATION documents, uploaded before
  -- the operator/tenant exists). RLS (tenant_id IS NOT DISTINCT FROM
  -- current_tenant_id()) makes those visible only in platform context.
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  purpose       text NOT NULL,
  provider      text NOT NULL CHECK (provider IN ('database', 'r2', 's3', 'azure')),
  bucket        text NOT NULL DEFAULT '',
  object_key    text NOT NULL CHECK (length(object_key) BETWEEN 3 AND 1024),
  visibility    text NOT NULL CHECK (visibility IN ('public', 'private')),
  file_name     text NOT NULL,
  -- No video types: video uploads are not supported anywhere on the platform.
  mime_type     text NOT NULL CHECK (mime_type IN (
                  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml',
                  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  -- Hard ceiling 5 MB; tighter per-purpose limits live in upload-policy.ts.
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete only: compliance papers are retained; the object itself is
  -- removed later by a retention job, never inline with a user action.
  deleted_at    timestamptz,
  UNIQUE (provider, bucket, object_key)
);
CREATE INDEX stored_files_tenant_idx ON stored_files (tenant_id, created_at DESC);
CREATE INDEX stored_files_provider_idx ON stored_files (provider) WHERE deleted_at IS NULL;
SELECT apply_tenant_rls('stored_files');

-- Bytes for the 'database' provider only (local dev / tests / emergency
-- fallback). Empty in production.
CREATE TABLE stored_file_blobs (
  object_key    text PRIMARY KEY,
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  content       bytea NOT NULL,
  content_type  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('stored_file_blobs');

-- ─── 2b. Bus photos ─────────────────────────────────────────────────────────
-- Photos are not compliance documents (no number, no expiry), so they get
-- their own table. Capped at 10 per bus in the service (row-locked).
-- Videos are NOT supported: the CHECK below and stored_files' MIME list
-- both refuse them, whatever a client sends.
CREATE TABLE vehicle_media (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'photo' CONSTRAINT vehicle_media_photo_only CHECK (kind = 'photo'),
  file_id       uuid NOT NULL UNIQUE REFERENCES stored_files(id),
  caption       text CHECK (caption IS NULL OR length(caption) <= 120),
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX vehicle_media_vehicle_idx ON vehicle_media (vehicle_id, position) WHERE deleted_at IS NULL;
SELECT apply_tenant_rls('vehicle_media');

-- Banners/offers now reference an uploaded file; image_url keeps the
-- resolved public (CDN) URL for fast rendering on the storefront.
ALTER TABLE cms_banners ADD COLUMN image_file_id uuid REFERENCES stored_files(id);
ALTER TABLE offers ADD COLUMN banner_file_id uuid REFERENCES stored_files(id);

-- ─── 3. Vehicle details + verification ─────────────────────────────────────
ALTER TABLE vehicles ADD COLUMN verification_status text NOT NULL DEFAULT 'draft'
  CHECK (verification_status IN ('draft', 'submitted', 'approved', 'rejected', 'suspended'));
ALTER TABLE vehicles ADD COLUMN verification_reason text;
ALTER TABLE vehicles ADD COLUMN submitted_at timestamptz;
ALTER TABLE vehicles ADD COLUMN verified_at timestamptz;
ALTER TABLE vehicles ADD COLUMN verified_by uuid REFERENCES users(id);
ALTER TABLE vehicles ADD COLUMN chassis_no text;
ALTER TABLE vehicles ADD COLUMN engine_no text;
ALTER TABLE vehicles ADD COLUMN fuel_type text CHECK (fuel_type IN ('diesel', 'cng', 'electric', 'petrol', 'hybrid', 'lng'));
ALTER TABLE vehicles ADD COLUMN body_color text;
ALTER TABLE vehicles ADD COLUMN registered_owner text;
ALTER TABLE vehicles ADD COLUMN registration_state text;
ALTER TABLE vehicles ADD COLUMN registration_date date;
ALTER TABLE vehicles ADD COLUMN gps_device_id text;
ALTER TABLE vehicles ADD COLUMN has_ac boolean;

-- Pre-existing buses were already selling tickets before verification
-- existed. Grandfather them as approved rather than silently pulling a live
-- fleet off sale on deploy; a scheduled re-verification can follow. (A fresh
-- database has no rows here, so seeds decide their own states.)
UPDATE vehicles SET verification_status = 'approved', verified_at = now(),
       verification_reason = 'Grandfathered at verification rollout (migration 0050)'
 WHERE deleted_at IS NULL;

CREATE INDEX vehicles_verification_idx ON vehicles (verification_status, submitted_at) WHERE deleted_at IS NULL;

-- One physical bus, one listing — across every operator.
CREATE UNIQUE INDEX vehicles_registration_global_uq ON vehicles (upper(registration_no)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_chassis_global_uq ON vehicles (upper(chassis_no)) WHERE deleted_at IS NULL AND chassis_no IS NOT NULL;

-- Identity is immutable. chassis_no may be filled in once (older rows lack
-- it) but never changed after that.
CREATE OR REPLACE FUNCTION vehicles_lock_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.registration_no IS DISTINCT FROM OLD.registration_no THEN
    RAISE EXCEPTION 'The registration number of a bus can never be changed once added'
      USING ERRCODE = '23514', CONSTRAINT = 'vehicle_registration_immutable';
  END IF;
  IF OLD.chassis_no IS NOT NULL AND NEW.chassis_no IS DISTINCT FROM OLD.chassis_no THEN
    RAISE EXCEPTION 'The chassis number of a bus can never be changed once set'
      USING ERRCODE = '23514', CONSTRAINT = 'vehicle_chassis_immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER vehicles_lock_identity BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION vehicles_lock_identity();

-- ─── 4. Versioned, verifiable documents ─────────────────────────────────────
ALTER TABLE vehicle_documents DROP CONSTRAINT IF EXISTS vehicle_documents_vehicle_id_doc_type_key;
ALTER TABLE vehicle_documents ADD COLUMN file_id uuid REFERENCES stored_files(id);
ALTER TABLE vehicle_documents ADD COLUMN verification_status text NOT NULL DEFAULT 'pending'
  CHECK (verification_status IN ('pending', 'verified', 'rejected'));
ALTER TABLE vehicle_documents ADD COLUMN rejection_reason text;
ALTER TABLE vehicle_documents ADD COLUMN verified_by uuid REFERENCES users(id);
ALTER TABLE vehicle_documents ADD COLUMN verified_at timestamptz;
ALTER TABLE vehicle_documents ADD COLUMN superseded_at timestamptz;
ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_valid_range
  CHECK (valid_from IS NULL OR valid_from <= expires_on);

-- Same grandfathering as the vehicles they belong to.
UPDATE vehicle_documents SET verification_status = 'verified', verified_at = now();

-- At most ONE open (pending) submission per bus + document type: a
-- re-upload replaces the pending one instead of piling up a review queue.
CREATE UNIQUE INDEX vehicle_documents_one_pending_uq ON vehicle_documents (vehicle_id, doc_type)
  WHERE verification_status = 'pending' AND superseded_at IS NULL;
CREATE INDEX vehicle_documents_review_idx ON vehicle_documents (verification_status, created_at) WHERE superseded_at IS NULL;

-- ─── 5. Guards: an unverified bus can never be put into service ────────────
CREATE OR REPLACE FUNCTION vehicle_is_approved(v uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = v AND verification_status = 'approved' AND deleted_at IS NULL);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION services_require_verified_vehicle() RETURNS trigger AS $$
BEGIN
  IF NEW.default_vehicle_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.default_vehicle_id IS DISTINCT FROM OLD.default_vehicle_id)
     AND NOT vehicle_is_approved(NEW.default_vehicle_id) THEN
    RAISE EXCEPTION 'This bus is not verified by the platform yet and cannot be assigned'
      USING ERRCODE = '23514', CONSTRAINT = 'vehicle_not_verified';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER services_require_verified_vehicle BEFORE INSERT OR UPDATE OF default_vehicle_id ON services
  FOR EACH ROW EXECUTE FUNCTION services_require_verified_vehicle();

-- Trips: an explicit (re)assignment of an unverified bus is refused. Automatic
-- materialisation from a service whose default bus has since been suspended
-- does NOT fail the whole run — the trip is created WITHOUT a bus, so ops
-- see it as "needs a bus" instead of a silently skipped departure.
CREATE OR REPLACE FUNCTION trips_require_verified_vehicle() RETURNS trigger AS $$
BEGIN
  IF NEW.vehicle_id IS NULL OR vehicle_is_approved(NEW.vehicle_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.vehicle_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    RAISE EXCEPTION 'This bus is not verified by the platform and cannot be assigned to a trip'
      USING ERRCODE = '23514', CONSTRAINT = 'vehicle_not_verified';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trips_require_verified_vehicle BEFORE INSERT OR UPDATE OF vehicle_id ON trips
  FOR EACH ROW EXECUTE FUNCTION trips_require_verified_vehicle();

-- migrate:down

DROP TRIGGER IF EXISTS trips_require_verified_vehicle ON trips;
DROP FUNCTION IF EXISTS trips_require_verified_vehicle();
DROP TRIGGER IF EXISTS services_require_verified_vehicle ON services;
DROP FUNCTION IF EXISTS services_require_verified_vehicle();
DROP FUNCTION IF EXISTS vehicle_is_approved(uuid);
DROP INDEX IF EXISTS vehicle_documents_review_idx;
DROP INDEX IF EXISTS vehicle_documents_one_pending_uq;
ALTER TABLE vehicle_documents DROP CONSTRAINT IF EXISTS vehicle_documents_valid_range;
ALTER TABLE vehicle_documents DROP COLUMN IF EXISTS superseded_at, DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verified_by, DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS verification_status, DROP COLUMN IF EXISTS file_id;
DROP TRIGGER IF EXISTS vehicles_lock_identity ON vehicles;
DROP FUNCTION IF EXISTS vehicles_lock_identity();
DROP INDEX IF EXISTS vehicles_chassis_global_uq;
DROP INDEX IF EXISTS vehicles_registration_global_uq;
DROP INDEX IF EXISTS vehicles_verification_idx;
ALTER TABLE vehicles DROP COLUMN IF EXISTS has_ac, DROP COLUMN IF EXISTS gps_device_id,
  DROP COLUMN IF EXISTS registration_date, DROP COLUMN IF EXISTS registration_state,
  DROP COLUMN IF EXISTS registered_owner, DROP COLUMN IF EXISTS body_color, DROP COLUMN IF EXISTS fuel_type,
  DROP COLUMN IF EXISTS engine_no, DROP COLUMN IF EXISTS chassis_no, DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verified_at, DROP COLUMN IF EXISTS submitted_at, DROP COLUMN IF EXISTS verification_reason,
  DROP COLUMN IF EXISTS verification_status;
ALTER TABLE offers DROP COLUMN IF EXISTS banner_file_id;
ALTER TABLE cms_banners DROP COLUMN IF EXISTS image_file_id;
DROP TABLE IF EXISTS vehicle_media;
DROP TABLE IF EXISTS stored_file_blobs;
DROP TABLE IF EXISTS stored_files;
DROP TABLE IF EXISTS operator_application_events;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS reopened_count, DROP COLUMN IF EXISTS review_note;
