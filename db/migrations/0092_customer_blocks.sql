-- =============================================================================
-- 0092_customer_blocks
--
-- Operators "blacklisted" customers by flagging users rows of their own tenant
-- — but customers hold one platform-wide account (tenant_id is NULL), so the
-- flag never matched anybody and nobody was ever blocked. A block is now the
-- operator's own record: by account and/or by mobile, with a reason; it stops
-- new bookings with THAT operator only.
-- =============================================================================

-- migrate:up
CREATE TABLE customer_blocks (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid REFERENCES users(id),
  phone        text,   -- last 10 digits of the mobile
  reason       text NOT NULL,
  blocked_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_blocks_who CHECK (customer_id IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT customer_blocks_phone CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')
);
CREATE UNIQUE INDEX customer_blocks_account ON customer_blocks (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX customer_blocks_phone_uq ON customer_blocks (tenant_id, phone) WHERE phone IS NOT NULL;
SELECT apply_tenant_rls('customer_blocks');

-- Bookings are looked up by mobile for the customer list and the block check.
CREATE INDEX IF NOT EXISTS bookings_contact_phone_idx ON bookings (tenant_id, contact_phone);

-- migrate:down
DROP INDEX IF EXISTS bookings_contact_phone_idx;
DROP TABLE IF EXISTS customer_blocks;
