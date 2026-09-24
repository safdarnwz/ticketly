-- =============================================================================
-- 0017_operator_onboarding
--
-- Public "Become an Operator" applications. These exist BEFORE any tenant, so
-- the table is platform-level (no tenant RLS). A super/platform admin reviews an
-- application; approval provisions a tenant + an operator-admin user.
-- =============================================================================

-- migrate:up

CREATE TYPE operator_application_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE operator_applications (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  status             operator_application_status NOT NULL DEFAULT 'pending',

  -- Personal (the applicant / prospective operator admin)
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  email              text NOT NULL,
  mobile             text NOT NULL,
  designation        text,
  -- Password chosen by the applicant, hashed at apply time; used to create the
  -- operator-admin user on approval (never stored in plaintext).
  password_hash      text NOT NULL,

  -- Company
  company_name       text NOT NULL,
  company_type       text,
  gst_number         text,
  pan_number         text,
  registration_number text,
  official_email     text,
  company_mobile     text,
  website            text,

  -- Address
  address_line1      text,
  address_line2      text,
  city               text,
  state              text,
  country            text DEFAULT 'India',
  pin_code           text,

  -- Business + documents (documents are stored as references/URLs in jsonb)
  business           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {numberOfBuses, busTypes[], cities[], yearsInBusiness, dailyTrips}
  documents          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {gstCertificate, pan, registration, ...} (uploaded refs)

  -- Review
  rejection_reason   text,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  provisioned_tenant_id uuid REFERENCES tenants(id),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_applications_status_idx ON operator_applications (status, created_at DESC);
CREATE UNIQUE INDEX operator_applications_pending_email_idx
  ON operator_applications (lower(email)) WHERE status = 'pending';
CREATE TRIGGER operator_applications_updated_at BEFORE UPDATE ON operator_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TABLE IF EXISTS operator_applications;
DROP TYPE IF EXISTS operator_application_status;
