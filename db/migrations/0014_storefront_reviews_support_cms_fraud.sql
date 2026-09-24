-- =============================================================================
-- 0014_storefront_reviews_support_cms_fraud
--
-- Storefront layer: verified-traveller reviews & ratings, customer support
-- tickets (with a message thread), a light CMS (pages, banners) + promotional
-- offers, and per-booking fraud risk assessments. All tenant-scoped tables carry
-- Row-Level Security.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- reviews — a rating (1–5) + optional text left by a customer who actually
-- travelled. One review per booking (the UNIQUE), and only a completed booking
-- is eligible (enforced in the service). `verified` records that the reviewer
-- was a genuine traveller, which is what a storefront badges.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE reviews (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES users(id),
  route_id      uuid REFERENCES routes(id),
  trip_id       uuid REFERENCES trips(id),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         text,
  body          text,
  verified      boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'published',  -- 'published'|'hidden'|'flagged'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, booking_id)
);
CREATE INDEX reviews_route_idx ON reviews (tenant_id, route_id) WHERE status = 'published';
CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- support_tickets — a customer support case, optionally linked to a booking.
-- A small state machine (open → pending → resolved → closed) drives it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support_tickets (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id   uuid REFERENCES users(id),
  subject       text NOT NULL,
  category      text NOT NULL DEFAULT 'general', -- 'refund'|'booking'|'payment'|'general'|...
  priority      text NOT NULL DEFAULT 'normal',  -- 'low'|'normal'|'high'|'urgent'
  status        text NOT NULL DEFAULT 'open',    -- 'open'|'pending'|'resolved'|'closed'
  assigned_to   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  closed_at     timestamptz
);
CREATE INDEX support_tickets_working_idx ON support_tickets (tenant_id, status) WHERE status IN ('open', 'pending');
CREATE INDEX support_tickets_customer_idx ON support_tickets (tenant_id, customer_id);
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- support_messages — the append-only thread on a ticket. `author_kind`
-- distinguishes the customer from an agent (or a system note).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE support_messages (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id     uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_kind   text NOT NULL,                  -- 'customer'|'agent'|'system'
  author_id     uuid REFERENCES users(id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- cms_pages — operator storefront content (terms, FAQ, about), addressed by a
-- URL slug and published/draft.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cms_pages (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft',   -- 'draft'|'published'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE TRIGGER cms_pages_updated_at BEFORE UPDATE ON cms_pages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- cms_banners — promotional banners for the storefront home, with a display
-- window and ordering.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE cms_banners (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  image_url     text,
  link_url      text,
  sort_order    smallint NOT NULL DEFAULT 0,
  active_from   timestamptz,
  active_to     timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cms_banners_active_idx ON cms_banners (tenant_id, is_active, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- offers — marketing offers surfaced on the storefront (a display layer over
-- pricing coupons). Validity window + optional coupon code it maps to.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE offers (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         text NOT NULL,
  description   text,
  coupon_code   text,
  banner_url    text,
  valid_from    timestamptz NOT NULL,
  valid_to      timestamptz NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (valid_to > valid_from)
);
CREATE INDEX offers_live_idx ON offers (tenant_id, is_active, valid_from, valid_to);
CREATE TRIGGER offers_updated_at BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- fraud_assessments — the risk score computed for a booking at hold/confirm.
-- Append-only audit of the decision + the attributable reasons (jsonb).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fraud_assessments (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES users(id),
  score         smallint NOT NULL,
  band          text NOT NULL,                  -- 'low'|'medium'|'high'
  decision      text NOT NULL,                  -- 'allow'|'review'|'deny'
  reasons       jsonb NOT NULL DEFAULT '[]',
  signals       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fraud_assessments_booking_idx ON fraud_assessments (booking_id);
CREATE INDEX fraud_assessments_review_idx ON fraud_assessments (tenant_id, decision) WHERE decision IN ('review', 'deny');

SELECT apply_tenant_rls('reviews');
SELECT apply_tenant_rls('support_tickets');
SELECT apply_tenant_rls('support_messages');
SELECT apply_tenant_rls('cms_pages');
SELECT apply_tenant_rls('cms_banners');
SELECT apply_tenant_rls('offers');
SELECT apply_tenant_rls('fraud_assessments');

-- migrate:down

DROP TABLE IF EXISTS fraud_assessments;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS cms_banners;
DROP TABLE IF EXISTS cms_pages;
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_tickets;
DROP TABLE IF EXISTS reviews;
