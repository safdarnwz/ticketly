# Fleet, Documents & Crew (Part 4)

The physical layer: buses and their legal documents, maintenance/fuel history,
and crew with a conflict-checked duty roster. Two pure domain engines carry the
risk here and are exhaustively tested (positive, negative, edge).

## Document expiry engine

An Indian commercial bus may not legally run without a valid **permit,
insurance, fitness certificate and PUC**. Running on an expired document risks
impoundment and stranded passengers. The engine answers three questions, all as
pure `LocalDate` logic (validity is a calendar concept — storing it as an
instant would introduce timezone drift on the boundary day):

- **Status of each document** — `valid`, `expiring_soon` (within a warn window,
  default 30 days), `expired`, or `missing`.
- **Is the vehicle road-legal today?** — true only when every *required*
  document is present and unexpired. "Expiring soon" is a warning, not a blocker.
- **Is it road-legal on a future journey date?** — the guard scheduling (Part 5)
  calls before assigning a vehicle to a trip, so a bus whose insurance lapses
  before the journey is never scheduled, even though it is valid today.

Edge cases covered by tests: expiring exactly today (valid through end of day),
a document with a future `validFrom` (not yet in effect → treated as missing),
warn-window boundary, and legality exactly on the expiry date. The worker
(Part 9) runs `documentsExpiringWithin` daily to emit
`vehicle.document_expiring` reminders.

## Duty-roster conflict engine

Assigning a driver has hard safety/legal constraints, enforced as pure interval
logic and never silently overridable:

1. **No overlap** — a crew member cannot be on two trips at once.
2. **Minimum rest** — a legally-mandated gap (default 8h) between consecutive
   duties; driver fatigue is a passenger-safety issue.
3. **Daily driving cap** — no more than a maximum (default 10h) of actual
   driving in any rolling 24h window.
4. **Max single-duty length** (default 16h).

`checkAssignment` returns *every* conflict (not just the first) so the operator
sees the full picture. Tested edges: touching intervals (`end == next start`)
are not an overlap but do violate rest; back-to-back at exactly the rest minimum
is allowed; two legal duties whose *combined* driving exceeds the 24h cap are
rejected; and multiple simultaneous conflicts are all reported.

### Defence in depth: a database backstop

The application check can lose a race — two schedulers assigning the same driver
in the same millisecond both pass, then both insert. So `crew_duties` also has a
PostgreSQL **exclusion constraint** (`EXCLUDE USING gist … tstzrange && `) that
makes two overlapping assigned duties for one crew member physically impossible
to commit. The second INSERT fails and surfaces as a clean 409. Verified against
real PostgreSQL: overlapping duties are rejected at the DB level; non-overlapping
ones are accepted.

## Vehicles, maintenance & fuel

Vehicles reference a vehicle type (Part 3) for their seat layout and amenities,
and may override the layout for a refit. Maintenance and fuel logs are
append-only operational history that feeds the cost reports in Part 10. All
monetary values are integer minor units (`Money`), never floats.

## Isolation

Every table (vehicles, vehicle_documents, maintenance_logs, fuel_logs, crew,
crew_duties) carries the standard tenant RLS policy from Part 2.
