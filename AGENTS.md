# Repository guide

## Purpose and stack

MegaKotxea is a small car-sharing coordination app. Users sign in, record themselves
as a driver or passenger for a date, add notes, view available capacity and driving
ratios, and export trip information.

- Frontend: static HTML with inline CSS and vanilla JavaScript; no build step or
  package manifest. Supabase JS v2 is loaded from jsDelivr.
- Authentication: Supabase email/password authentication and password recovery.
- Backend: one TypeScript Supabase Edge Function running on Deno.
- Data: Supabase Postgres, with schema, triggers, policies, and a statistics RPC
  defined in a SQL migration.
- Hosting: Firebase Hosting serves `frontend/` and rewrites paths to `index.html`.

## File map

| Path | Responsibility |
| --- | --- |
| `frontend/index.html` | Entire UI, authentication, week/date calculations, API calls, trip rendering, statistics, CSV download, and shareable text generation. |
| `frontend/env.js` | Browser-visible Supabase URL and public anon key; loaded before the inline app script. |
| `backend/supabase/functions/trips/index.ts` | CORS, JWT verification, trip reads/upserts/deletes, CSV generation, and statistics RPC invocation. |
| `backend/supabase/migrations/20250319233803_init.sql` | Initial database schema, auth/profile trigger, timestamp trigger, RLS policies, and `get_trip_ratios()`. |
| `firebase.json` | Static hosting directory, ignored files, and SPA rewrite. |
| `.firebaserc` | Default Firebase project: `ik-car-sharing`. |
| `.github/workflows/` | Firebase preview/live deployment and Supabase function deployment workflows. |
| `tests/planning.test.cjs` | Node tests for company grouping, capacity, shareable text, and trip actions using a DOM stub. |

## Request and data flow

1. The browser creates `supabasecli` using globals from `env.js`.
2. Login or session restoration sets `USER`, selects a week, and fetches trips and
   statistics. Weekend defaults advance to the following week.
3. `supabasecli.functions.invoke(...)` calls the `trips` function with the session.
4. The function verifies a bearer JWT with `JWT_SECRET`, derives the user ID from
   `sub`, and accesses Postgres using `SUPABASE_SERVICE_ROLE_KEY`.
5. Successful trip mutations refresh the trip list and statistics.

The Edge Function requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`JWT_SECRET`. Keep service-role and JWT secrets out of frontend files. The tracked
anon key is browser configuration, not a server credential.

### API implemented by the function

All routes below require authentication; `OPTIONS` handles CORS before auth.

| Request | Behavior |
| --- | --- |
| `GET /trips?start=YYYY-MM-DD&end=YYYY-MM-DD` | Returns `{ trips }` with joined profile email, names, seats, and company. Both date filters are optional and inclusive. |
| `GET /trips?stats=true` | Returns `{ stats }` from `get_trip_ratios()`; takes precedence over CSV mode. |
| `GET /trips?csv=true` | Returns CSV; optional start/end filters also apply. The UI currently exports all dates. |
| `POST /trips` | Upserts `{ trip_date, is_driver, notes }` for the authenticated user; returns `{ trip }` with status 201. |
| `DELETE /trips/YYYY-MM-DD` | Deletes the authenticated user's entry for that date. The path parameter is a date, despite being named `id` internally. |

### Data and business rules

- `profiles.id` references `auth.users`; the auth insert trigger creates profiles
  from email and `first_name`/`last_name` user metadata. There is no signup UI.
- Profiles have `seats` (default 5), `is_active` (default true), and nullable
  `company`. Company must currently be assigned on profiles separately; the auth
  insert trigger does not copy it from user metadata. Existing databases also need
  the company column applied before deploying the updated trips function.
- `trips` has a composite primary key `(trip_date, user_id)`: one entry per user
  per date. Changing driver/passenger status updates that entry.
- Creation, updates, and deletion reject past dates using `Europe/Madrid` in both
  the UI and Edge Function. Reads can include historical trips.
- The UI renders Monday through Friday, grouping each day's participants by
  company, sorted by name. Blank/missing companies appear last as "Sin empresa".
  Capacity is calculated separately for each company, summing drivers' profile
  seats and comparing that with all participants, including drivers. Each day also
  shows the overall participant/seat count and capacity indicator across companies,
  since users can share rides with other companies. The shareable
  weekly text uses the same company groups. CSV and statistics remain global.
- Days before today's Madrid date render as native `details` sections, collapsed
  by default. Their summaries retain the daily count and capacity indicator;
  users can expand them to inspect company groups. Today and future days stay open.
- Ratios are driver trips divided by all trips. Statistics cover all dates and
  active profiles, plus a TOTAL row; they are not filtered to the selected week.
- The consolidated statistics use `trip_date < CURRENT_DATE` in Postgres, which
  excludes today and follows the database date/timezone.
- Tables enable RLS; the Edge Function uses a service-role client. Preserve
  server-side ownership checks because this client bypasses RLS.
- UI labels mix Spanish and English; generated weekly messages use Basque weekday
  names. The clipboard button only toggles a text area; it does not copy text.

## Development and validation

- Keep changes within the existing static frontend/Deno structure unless the task
  calls for a larger refactor. There is no npm install/build/test script.
- For a basic frontend preview, run `python3 -m http.server 8000 --directory frontend`
  from the repo root, if Python is available. This uses the configured remote
  Supabase backend; it does not create a local backend or emulate Firebase rewrites.
- Run `node --test tests/planning.test.cjs` for planning regression tests. These
  execute the frontend script with a DOM stub and do not connect to Supabase.
- The repository has no lint configuration, Supabase `config.toml`, or documented
  local database setup. Do not claim checks ran when the required tools or services
  are unavailable.
- For UI changes, check login/session restoration, week navigation, adding and
  switching roles, notes, deletion, capacity indicators, statistics, exports, and
  error display as relevant. Use a test account/environment for mutations.
- For date changes, include year boundaries, weekends, and Madrid midnight. For
  backend changes, check missing/invalid auth, ownership, and past-date rejection.
- Add new schema changes as migrations rather than rewriting the initial migration
  for an already-deployed database. Keep API fields and frontend consumers aligned.
- Update this guide when architecture or workflows change.

## Deployment behavior

- Firebase PR previews run for same-repository PRs. Live hosting deployment runs
  on pushes to `main` affecting `frontend/**`.
- Supabase PR deployment also runs for same-repository PRs and targets the
  configured `PROJECT_ID`; there is no separate preview project in that workflow.
- Supabase merge deployment runs on `main` changes under
  `backend/supabase/functions/**`, and can also be manually dispatched.
- Both backend workflows run
  `supabase functions deploy --remote="$PROJECT_ID" --workdir backend --yes`
  on Ubuntu 24.04. The confirmation flag is required for noninteractive CI.
- CI uses `FIREBASE_SERVICE_ACCOUNT_IK_CAR_SHARING`, `SUPABASE_ACCESS_TOKEN`, and
  the `PROJECT_ID` repository variable. No workflow applies database migrations.
- Changes only to `firebase.json` or migrations do not trigger the corresponding
  path-filtered live deployments above.

## Existing pitfalls to consider for related work

These are observations from the source, not fixes included in this guide:

- Week selection, date ranges, and CSV week grouping use different calculations;
  CSV groups by week number without a year, and does not escape CSV field content.
- Successful password recovery calls `.reset()` on `#resetForm`, which is a `div`.
- POST body validation is limited; do not assume the UI enforces server invariants.
- The initial SQL includes policy syntax that needs validation before a fresh
  database bootstrap (for example, an INSERT policy includes `USING`). A checked-in
  migration alone does not establish that a clean database setup succeeds.
