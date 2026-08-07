# Add Strava as a second activity source

## Context
Right now `activities` only comes from the Garmin watch via MTP/.FIT. The user wants Strava
as a second, independent source (OAuth API, JSON not FIT), reusing the existing Withings
OAuth pattern (`withings-auth.ts`, popup login, always-checked token status). Two things
drive the design: (1) Strava and Garmin can legitimately describe the *same* workout (if
Garmin Connect auto-uploads to Strava), so duplicates must be detected, not just appended;
(2) the user is planning AI analysis later and wants raw source data preserved the same way
`fit-archive/` preserves raw `.FIT` files — for Strava that means raw JSON (summary + detail
+ streams), since **Strava's public API has no "download original file" endpoint for
third-party apps** — this is a real capability gap I'm being upfront about rather than
quietly assuming otherwise.

Decisions already confirmed with the user: detect & skip cross-source duplicates; use
`activity:read_all` scope (private activities included); fetch per-activity `streams` too,
so Strava-sourced activities get full detail charts/GPS just like Garmin ones (accepting
the added Strava API calls / rate-limit cost).

## What you need to do first
1. Go to **https://www.strava.com/settings/api** and create an API application.
   - **Authorization Callback Domain**: set to `localhost`. Strava validates the OAuth
     redirect against this *domain* only (not a full exact URL like Withings requires), so
     the callback can live on the main server (see below) without registering an exact path.
   - Note the **Client ID** and **Client Secret** it gives you.
2. That's it for setup — I'll add a `strava` block to `garmin-stats/config.json` (mirroring
   the existing `withings` block) with placeholder values; you fill in the real client_id/
   secret. No manual server/callback setup needed — same "Login to Strava" popup pattern as
   Withings handles the rest once the code is in.
3. Worth knowing: Strava's default app rate limit is ~200 requests/15min, 2,000/day. Fetching
   `streams` per activity means a large first-time historical backfill (hundreds of
   activities) could take multiple sync runs spread over time rather than completing in one
   shot — the sync is incremental (like Withings' "since last sync") so this is a one-time
   cost, not ongoing.

## Backend changes

**DB migration** (`db.ts`) — first schema change this app has needed since initial deploy:
- `activities`: add `source TEXT NOT NULL DEFAULT 'garmin'` via an idempotent
  `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info(activities)` check in
  `initSchema()` (safe on existing DBs, `CREATE TABLE IF NOT EXISTS` alone won't add columns
  to an already-existing table). Existing rows default to `'garmin'` — correct, since they
  all are.
- Keep `filename` as the unique key (no constraint rework needed) — Strava rows get a
  synthetic filename `strava-<activity_id>.json`, parallel to Garmin's `<timestamp>.fit`
  convention, so the existing `UNIQUE(filename)` continues to prevent re-importing the same
  Strava activity twice.
- New `strava_tokens` table, exact structural mirror of `withings_tokens`.

**`strava-auth.ts`** (new) — structural mirror of `withings-auth.ts`: `getAuthUrl`,
`exchangeCode`, `refreshToken` (Strava rotates refresh tokens on use — must persist the new
one each time, same as Withings), `getValidToken`, `getTokenStatus`. Strava's token response
shape differs slightly (`expires_at` given directly, not `expires_in`; first exchange also
returns an `athlete` object we can ignore).

**`sync-strava.ts`** (new), incremental like `sync-withings.ts`:
1. `GET /athlete/activities?after=<ts>&page=&per_page=` for the list (paginated).
2. Per new activity: `GET /activities/{id}` for detail (adds `calories`, which the list
   endpoint omits) + `GET /activities/{id}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp`.
3. **Dedup check** before insert: query existing `activities` (any source) for a row whose
   `activity_date` is within ~10 minutes of the Strava activity's start and whose
   `distance_m` is within ~10% — if found, skip and count as a duplicate (surfaced in the
   sync summary like `imported`/`skipped`/`errors` are today). Tolerance is adjustable if it
   proves too loose/tight in practice.
4. Map fields → `activities` columns: `start_date_local` → `activity_date`; `type`/
   `sport_type` → `sport` via a lookup table (Run/TrailRun→running, Ride/VirtualRide→cycling,
   Walk→walking, Hike→hiking, Swim→swimming, else→other); `distance`→`distance_m`;
   `moving_time`→`duration_sec`; `total_elevation_gain`→`ascent_m` (`descent_m` stays null —
   Strava doesn't expose total descent); `average_speed`/`max_speed`→`avg_speed_ms`/
   `max_speed_ms`; `average_heartrate`/`max_heartrate`→`avg_hr`/`max_hr`; `calories` (from
   detail) → `calories`; `average_cadence`→`avg_cadence`, **×2 for running** to match the
   existing Garmin convention (`CLAUDE.md`'s FIT notes: field 89 × 2 = steps/min) — Strava
   also reports single-leg cadence for runs, so skipping this would make Strava runs show
   half the cadence of Garmin runs in the same charts.
5. Map `streams` → `track_points` rows (same shape as the FIT parser's output): `time`→
   `elapsed_sec`, `distance`→`distance_m`, `heartrate`→`heart_rate`, `velocity_smooth`→
   `speed_ms`, `cadence`→`cadence` (×2 for running, same reasoning), `altitude`→`altitude_m`,
   `watts`→`power`, `temp`→`temperature`, `latlng[i]`→`lat`/`lon`.
6. Archive the raw API responses (summary + detail + streams, as-received) to
   `garmin-stats/strava-archive/<id>.json` — permanent, gitignored, same spirit as
   `fit-archive/` for future AI analysis, with the caveat noted above that it's JSON, not a
   FIT file.

**`server.ts`**:
- New routes on the existing port-3001 router (no new permanent port, unlike Withings'
  3002 — Strava only needs the callback *domain* to match, so it can live at
  `/api/strava/callback` on the main server): `GET /api/strava/status`,
  `GET /api/strava/login-url`, `GET /api/strava/callback`, `POST /api/sync/strava?from=&to=`.
- Reuse/generalize the existing `withingsCallbackPage()` HTML helper for both providers.

## Frontend changes
- `types/api.ts`: add `StravaStatus` (mirrors `WithingsStatus`); add optional `source?: string`
  to `Activity` so the UI can show provenance.
- `api/client.ts`: `api.strava.tokenStatus()`, `api.strava.loginUrl()`,
  `api.strava.sync(from?, to?)`.
- `ManageTab.tsx`: new `StravaSyncSection`, structural copy of `WithingsSyncSection` (status
  line, login popup via `window.open` + poll, own date range, sync button). Added as a third
  card under "Sync". `SyncAllBar` extended to also check Strava's token and run its sync,
  skipping with a note if not connected — same pattern already used for Garmin/Withings.
- Small polish: a source badge (Garmin/Strava) next to each activity in the list and in
  `ActivityModal`, reusing the existing `Badge` component — cheap, and useful for eyeballing
  that dedup is working correctly.

## Verification
1. `npm run typecheck` in both `garmin-stats/` and `garmin-dashboard/`.
2. Confirm the DB migration is non-destructive: run against the existing populated DB, check
   `PRAGMA table_info(activities)` shows `source`, existing rows read back as `source='garmin'`.
3. Fill in real Strava credentials in `config.json`, restart the server, click "Login to
   Strava" → popup completes → status flips to connected (mirrors the already-working
   Withings flow, so this validates the port-3001-callback approach works the same way).
4. Run a Strava sync over a small recent range; verify: rows land with `source='strava'`,
   `strava-archive/*.json` files are written, `track_points` are populated (chart renders in
   `ActivityModal`), and — if any Strava activity overlaps a known Garmin one — confirm it's
   skipped as a duplicate rather than double-imported.
