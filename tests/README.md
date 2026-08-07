# API regression safety net (golden-master snapshots)

This project had **no automated tests** before the layered-API refactor. To refactor the REST API
behavior-preservingly, we use **characterization ("golden master") snapshots**: capture the exact
JSON responses (and HTTP status codes) of every deterministic read endpoint *before* the refactor,
then re-capture *after* and diff. Any difference = a behavior change to investigate.

## Files
- `snapshot.sh` — the runner (committed). Hits every deterministic GET endpoint with **fixed**
  params and writes one pretty-printed `<name>.json` per endpoint plus a `_status.txt` manifest of
  HTTP status codes.
- `baseline/` — the "before" snapshots. **Git-ignored** because they contain personal health data
  (distances, heart rate, body weight/fat). They live locally only, as the comparison net.
- `after/` — regenerated after each change; diffed against `baseline/`. Also git-ignored.

## Usage
```bash
# server must be running on :3001 with the SAME DB state throughout
npm --prefix garmin-stats run server         # or: node garmin-stats/src/server.ts

bash tests/snapshot.sh http://127.0.0.1:3001 tests/baseline   # once, before refactor
# ...make a change, restart server...
bash tests/snapshot.sh http://127.0.0.1:3001 tests/after      # after
diff -rq tests/baseline tests/after                           # must be empty
diff -u  tests/baseline/_status.txt tests/after/_status.txt   # status codes must match
```

## Determinism rules (why the comparison is valid)
- **Fixed, hardcoded** `from`/`to` params (a wide window covering all data + a narrow recent one).
- **No mutating routes are ever called** — no sync, POST, PUT, or DELETE. The script cannot change
  DB state, and you must **not** re-sync Garmin/Withings/Strava between before/after, or the DB
  differs and the diff is meaningless.
- Verified identical across two consecutive runs (fully deterministic).

## Endpoints covered (23 snapshots)
All deterministic read endpoints: `/api/range`, `/api/body/range`, `/api/settings`,
`/api/activities(+/count,/trash)`, `/api/summary`, `/api/weekly`, `/api/monthly`,
`/api/body/list(+/count,/trash,/monthly,/correlation)`, `/api/activity/:id`, `/api/track/:id`
— each at the fixed windows and fixed ids in `snapshot.sh`.

## Deliberately NOT snapshotted (and why)
- `*/login-url` (Withings/Strava) — generate a fresh random OAuth `state` every call → non-deterministic.
- `/api/garmin/status` — shells out to a ~15s PowerShell device probe; needs the watch plugged in.
- `/api/withings/status`, `/api/strava/status` — may hit the network / refresh tokens.
- `/api/strava/callback` — OAuth redirect target, needs a real `code`.
- `/api/settings/background-image` — streams binary image bytes, not JSON.
- All mutating routes (sync/POST/PUT/DELETE) — would change DB state.

## Known behavioral quirk captured by the baseline (do NOT "fix" during the refactor)
- **`GET /api/body/correlation` returns `204 No Content` on an empty result set**, while every other
  list endpoint returns `200` with `[]`. It's empty here because the activity date range
  (2025-08 → 2026-08) and the body-measurement date range (2024-08 → 2025-07) don't overlap, so the
  weekly-km ↔ avg-weight join has no rows. This 204-vs-`[]` inconsistency is a candidate real bug —
  it is to be **recorded in Jira**, not silently changed, per the refactor's behavior-preserving rule.
