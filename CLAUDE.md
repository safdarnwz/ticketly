# Working rules for this repository

These apply to every change, backend and frontend (the web app lives in the separate
`ticketly-web` project and follows the same rules).

## Edge cases are part of the change
Every feature or bug fix covers its edge cases, on both sides:
- Backend: invalid / missing input, wrong state (already cancelled, departed, approved…),
  another operator's ids (tenant isolation), permissions, duplicates and concurrency
  (double click, retry — idempotency), limits and quotas, empty results.
  Each gets a test (unit for domain rules, e2e for API behaviour).
- Frontend: loading, empty, error (show the backend's message), disabled states while a
  request is in flight, validation shown next to the field, no permission, and the same
  wrong-state cases the backend rejects.
- Verify against a running API, not only by reading code.

## No duplicate functionality
Before adding an endpoint, service, page or component, search for an existing one that
does the same job and extend it. One feature has one backend path and one screen.
`npm run check:boundaries` and the architecture tests guard the backend structure.

## Scenarios are done on both sides
A scenario in `docs/SCENARIOS.md` is **DONE** only when it works in the backend AND in
the web app. The tracker records both (`Backend` / `Frontend` columns).

## Checks before committing
`npm run check` (format, lint, typecheck, unit tests); e2e for API behaviour changes.
