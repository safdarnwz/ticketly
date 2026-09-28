-- ============================================================================
--  Route promotions (sponsored listings) — "Prio" badge feature
-- ============================================================================
-- An operator pays to have a route's trips bubble into the TOP 3 of search
-- results for that route's origin/destination, regardless of how the
-- customer sorts or filters (price, departure time, rating, AC-only, etc.)
-- — the same "sponsored slot" model major travel booking sites
-- and most e-commerce search results use.
--
-- Pricing is PLATFORM-WIDE (super-admin sets one rate card for everyone —
-- there's no per-operator negotiation here), with two independent axes:
--   - billing_cycle: daily / weekly / monthly
--   - bundle: single-route vs multi-route (buying 2+ routes together in one
--             purchase, typically at a per-route discount vs buying each
--             route separately — see group_id below)
--
-- A rate CHANGE by super-admin must never silently alter what an operator is
-- already being charged mid-cycle — route_promotions snapshots its own
-- price_minor at purchase time from whatever rate was in effect then, so a
-- later rate-card change only affects the NEXT purchase, never a retroactive
-- rewrite of an active promotion's price (the same non-retroactive-billing
-- principle platform_charges.amount_minor already documents).

CREATE TABLE promotion_pricing_rules (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  billing_cycle     text NOT NULL,                 -- 'daily' | 'weekly' | 'monthly'
  is_multi_route    boolean NOT NULL,               -- false = single-route rate, true = per-route rate when bundled with other routes
  price_minor       bigint NOT NULL CHECK (price_minor >= 0),
  currency          char(3) NOT NULL DEFAULT 'INR',
  effective_from    timestamptz NOT NULL DEFAULT now(),
  effective_to      timestamptz,                    -- NULL = currently in effect; superseded rules get this set when replaced
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Only one CURRENTLY-active rate per (cycle, bundle-type) — superseding a
  -- rate means closing the old row's effective_to, never deleting history
  -- (a promotion purchased under an old rate still needs to explain its own
  -- price_minor later, e.g. on an invoice line item or a billing dispute).
  UNIQUE (billing_cycle, is_multi_route, effective_from)
);
CREATE INDEX promotion_pricing_rules_active_idx ON promotion_pricing_rules (billing_cycle, is_multi_route) WHERE effective_to IS NULL;

CREATE TABLE route_promotions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id          uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  -- Purchases made together (an operator promoting 3 routes in one checkout)
  -- share a group_id — this is what determines "multi-route" pricing
  -- (2+ distinct route_promotions sharing a group_id) versus single-route,
  -- and lets one invoice/platform_charges entry cover the whole bundle
  -- rather than N separate charges for what the operator experienced as
  -- one purchase.
  group_id          uuid NOT NULL,
  billing_cycle     text NOT NULL,                  -- 'daily' | 'weekly' | 'monthly'
  price_minor       bigint NOT NULL,                 -- snapshotted from promotion_pricing_rules at purchase time
  currency          char(3) NOT NULL DEFAULT 'INR',
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'pending_payment',  -- 'pending_payment' | 'active' | 'expired' | 'cancelled'
  auto_renew        boolean NOT NULL DEFAULT false,
  platform_charge_id uuid REFERENCES platform_charges(id),
  cancelled_at      timestamptz,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX route_promotions_tenant_idx ON route_promotions (tenant_id, status);
-- The hot-path index: "which routes are actively promoted right now" — used
-- on every search that has 3+ candidate results, so it needs to be fast and
-- narrow (partial index on the active-and-current-window rows only).
CREATE INDEX route_promotions_active_window_idx ON route_promotions (route_id, starts_at, ends_at) WHERE status = 'active';
CREATE TRIGGER route_promotions_updated_at BEFORE UPDATE ON route_promotions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('route_promotions');

COMMENT ON COLUMN route_promotions.status IS
  'pending_payment: created but payment/platform_charge not yet settled — NEVER shown in search (see SearchService). active: currently boosting search results. expired: ends_at has passed, not renewed. cancelled: operator or platform cancelled before natural expiry — see PromotionService.cancel() for the prorated-refund reasoning.';
