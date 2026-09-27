# Remaining work (audit, 2026-09-27)

Source of truth: [SCENARIOS.md](SCENARIOS.md). A scenario is complete only when both the backend
and the web app are DONE.

## Where it stands

| | Rows |
|---|---|
| Backend DONE | 970 |
| … and the web app DONE too (complete) | 597 |
| Backend DONE, screen not built or not verified (frontend TODO) | 379 |
| GAP — in scope, not built | 289 |
| CONFLICT — contradicts an earlier decision (way-side cash, counter wallets…) | 77 |
| INFRA / PROCESS — deployment or business practice, not app code | 26 |
| OPEN — not reviewed yet (rows 1251 onward, mostly strategy and "should" statements) | 2716 |

## Built in this round (backend + web, e2e and browser-checked)

- **Agent portal** (481–550): home, book, bookings with commission, booking changes, cancel,
  statement, help.
- **Crew app** (622–675, 584): crew login given by the operator; own duties and attendance; manifest by
  boarding point, board / code check-in, reports (delay, breakdown, cleaning, maintenance, complaint),
  lost items, live GPS, panic button.
- **Customer Manage booking**: My trips (signed in) or PNR + mobile; change date (buses through the same
  points, exact price, pay the difference), seats, boarding / drop point, name spelling, cancel some seats
  or all, ticket, tracking, support, review.
- **Super admin console** (1–120): integrations, security, business rules, role templates, system and
  i18n settings; operator settings (domain, favicon, rate limit, feature flags); applications
  (details, hold, reopen); bus approvals; OTA partners; billing; platform health; plans with quotas.
- Fixes found on the way: agent statement days were UTC days; platform "today" was a UTC day; a
  report / SOS from the crew app could hang on an unanswered location prompt; a feature flag for an
  unknown operator answered 200.

## GAP by area (292)

| Area (rows) | GAPs | Examples |
|---|---|---|
| Super admin (1–120) | 5 | per-operator colours (65, 66), offline sync rules (68), report templates / builder (73, 74) |
| Operator admin settings (121–300) | 17 | surge pricing rule (232), waitlist auto-confirm (238), auto seat assignment (248, 249), luggage allowance and charges (252, 253), pickup / drop surcharges (286, 287), Excel schedule upload (268) |
| Operator finance & agents (301–350) | 32 | agent ranking / incentives / penalties (302–305), agent tax invoice and TDS (310, 311), branch targets and expense approval (316–321), receivables / OTA payables / settlement matching (326–329), GST and TDS return data (330, 331), cash-flow and budget alerts (342–344), month-end pack (349) |
| Branch (351–480) | 40 | branch dashboard and day-end report (351, 352, 381, 382), occupancy / revenue trends (383–385), group / corporate booking handling (396, 397, 436–438), watch list (461) |
| Agent (481–550) | 25 | wallet recharge (484–486), ticket PDF / share (503, 504), date change (512–514), group / quota bookings (523–526), own performance (536–538), saved routes / passengers, profile and bank (542–546) |
| Dispatch & crew (551–700) | 26 | offline dispatch (614–616), manual tracking (617), crew-side seat / point / name changes (638–642), luggage (644, 645), next-stop ETA (651), trip-end report and fuel / mileage (654, 663, 664, 674, 675), night checklist (672) |
| Inventory & schedule (701–800) | 10 | schedule clash detection (721, 722), merging buses (724), passenger notice on schedule change (733), Excel template / upload (734, 735), seat-wise and stage-wise reports (739, 740) |
| Concurrency (901–1000) | 6 | 988–992, 1000 |
| Payments & refunds (1001–1100) | 39 | chargebacks / disputes (1053, 1054), refund approvals and holds (1056–1062), refund liability and ageing (1087, 1088), refund receipt (1096) |
| Offline mode (1101–1200) | 73 | the whole offline booking / sync area — needs a product decision (it overlaps the way-side cash CONFLICT rows) |
| Business rules (1201–1300) | 16 | 1207, 1208, 1219, 1220, 1229, 1234–1241 |

## Frontend TODO (379)

Mostly rows whose backend is a rule or a job rather than a screen — concurrency (901–1000), payment and
refund edge cases (1001–1100), business rules (1201–1300) and the agent / OTA strategy rows in the
3000s. They need a check that the existing screens show the backend's message for each case, not new
screens.

## Suggested next steps

1. Decide offline mode and way-side cash (73 GAP + 77 CONFLICT rows hang on it).
2. Operator finance pack: agent tax invoice / TDS, GST and TDS return data, receivables and OTA
   settlement matching (326–331).
3. Operator settings still missing: waitlist auto-confirm, luggage, surcharges,
   automatic seat assignment.
4. Review the OPEN rows (1251+) and mark them DONE / GAP / out of scope.
