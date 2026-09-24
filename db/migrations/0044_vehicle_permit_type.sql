-- Bus permit-type tracking (Motor Vehicles Act, 1988 permit categories):
--   'aitp'                  All India Tourist Permit — the category most private
--                           interstate Volvo/sleeper operators actually run under.
--   'stage_carriage'        Fixed-route, individual-ticket carriage — the category
--                           state-transport corporations (KSRTC, APSRTC, etc.) and
--                           some state-route-permitted private operators use.
--   'state_tourist_permit'  Tourist operation confined to a state/region's own rules.
--   'contract_carriage'     The WHOLE vehicle is hired to a single party (a wedding
--                           group, a corporate outing) — NOT individual-seat sale to
--                           the public. Recorded for completeness (a tenant's fleet
--                           may include vehicles used for charter/private-hire work
--                           outside this platform), but a contract-carriage vehicle
--                           can never be the vehicle for a trip that sells individual
--                           seats here — enforced in application code (see
--                           FleetService.isRoadLegalOn's caller in materialisation),
--                           since it needs to reason about the trip's own sale-mode,
--                           not just the vehicle row alone.
--
-- Only the CATEGORY lives here — the permit's own document-number and expiry
-- date already have a home in vehicle_documents (doc_type = 'permit', which
-- already existed before this migration), so this doesn't duplicate that.
CREATE TYPE permit_type AS ENUM ('aitp', 'stage_carriage', 'state_tourist_permit', 'contract_carriage');

ALTER TABLE vehicles ADD COLUMN permit_type permit_type;

COMMENT ON COLUMN vehicles.permit_type IS
  'Motor Vehicles Act permit category this vehicle actually holds. NULL means not yet recorded — treated as unknown, never assumed stage_carriage, by the individual-seat-sale guard in materialisation.';
