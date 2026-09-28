# Working rules for ticketly-web

Same rules as the backend (`ticketly-backend/CLAUDE.md`):

- **Edge cases, every time:** loading, empty, error (show the backend's message from
  `ApiError`), in-flight/disabled buttons (no double submit), field validation next to
  the input, no-permission, and every wrong state the backend can answer with
  (already cancelled, departed, sold out, hold expired…). Check them in the browser
  against a running backend, not only in code.
- **No duplicates:** one API function per endpoint (in `src/lib/api/`), one screen per
  feature, shared components in `src/components/`. Search before adding.
- **Fully dynamic:** no hard-coded data — everything comes from the API.
- **Theme stays as it is:** use the existing design tokens and UI components.
- A scenario is done only when backend and frontend both work.
- Before committing: `npm run typecheck`, `npm run lint`, `npm run build`.
