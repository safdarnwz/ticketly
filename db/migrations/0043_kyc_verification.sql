-- =============================================================================
-- 0043_kyc_verification
--
-- KYC verification for operator onboarding:
--   - PAN: an instant, free, offline format/checksum check, PLUS an actual
--     PAN-database match via Digio's KYC API.
--   - Aadhaar: Digio's Aadhaar OKYC (OTP-based e-KYC against UIDAI) — the
--     applicant enters their Aadhaar number, an OTP goes to their
--     Aadhaar-linked mobile, they submit it back to us, Digio confirms it.
--   - Bank account: Digio's bank-account-verification (penny-drop /
--     account-aggregator-backed) — given account number + IFSC, confirms
--     the account exists and returns the registered account-holder name.
--
-- Digio is a PAID provider (unlike DigiLocker) — see KycService's own doc
-- comment for what that means for a deployment without paid credentials.
--
-- COMPLIANCE: the Aadhaar Act, 2016 (Section 29) restricts storing/sharing
-- a full Aadhaar number. This schema NEVER has a column for one — only
-- masked_number (e.g. "XXXX XXXX 1234") is ever persisted.
-- =============================================================================

-- migrate:up

CREATE TYPE kyc_document_type AS ENUM ('pan', 'aadhaar', 'bank_account');
CREATE TYPE kyc_verification_status AS ENUM ('pending', 'otp_sent', 'verified', 'failed', 'expired');

CREATE TABLE kyc_verifications (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  operator_application_id   uuid NOT NULL REFERENCES operator_applications(id) ON DELETE CASCADE,
  document_type             kyc_document_type NOT NULL,
  status                    kyc_verification_status NOT NULL DEFAULT 'pending',
  -- 'format_check' = offline PAN structure+checksum validation (no API call).
  -- 'digio'        = an actual Digio API verification (PAN-database match,
  --                  Aadhaar OKYC, or bank-account penny-drop).
  provider                  text NOT NULL,
  provider_reference        text,   -- Digio's own request/client_id for this verification (needed to submit the matching OTP)
  verified_name             text,   -- name exactly as returned by the verified record
  masked_number             text,   -- PAN in full (not sensitive), Aadhaar as "XXXX XXXX 1234", or bank account as "XXXXXX1234"
  ifsc                      text,   -- bank_account verifications only
  failure_reason            text,
  verified_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_verifications_application_idx ON kyc_verifications (operator_application_id);
CREATE TRIGGER kyc_verifications_updated_at BEFORE UPDATE ON kyc_verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE operator_applications ADD COLUMN pan_verification_status kyc_verification_status;
ALTER TABLE operator_applications ADD COLUMN aadhaar_verification_status kyc_verification_status;
ALTER TABLE operator_applications ADD COLUMN bank_account_verification_status kyc_verification_status;

-- migrate:down

ALTER TABLE operator_applications DROP COLUMN IF EXISTS bank_account_verification_status;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS aadhaar_verification_status;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS pan_verification_status;
DROP TABLE IF EXISTS kyc_verifications;
DROP TYPE IF EXISTS kyc_verification_status;
DROP TYPE IF EXISTS kyc_document_type;
