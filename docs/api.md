# API endpoints (server.ts — port 3001)

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.


### GET
| Endpoint | Description |
|---|---|
| `/api/range` | Min/max date in activities |
| `/api/activities?from=&to=` | Activity list |
| `/api/activity/:id` | Single activity |
| `/api/summary?from=&to=` | Totals grouped by sport |
| `/api/weekly?from=&to=` | Weekly aggregates |
| `/api/monthly?from=&to=` | Monthly aggregates |
| `/api/track/:id` | Track points for one activity |
| `/api/body/range` | Min/max date in body_measurements |
| `/api/body/list?from=&to=` | Body measurements list |
| `/api/body/monthly?from=&to=` | Monthly body averages |
| `/api/body/correlation?from=&to=` | Weekly km + avg weight |
| `/api/garmin/status` | Runs `check-garmin-device.ps1` (no file copying, ~15s timeout), returns `{connected, reason?}` — gates the "Sync from device" button |
| `/api/withings/status` | Token presence/validity from `withings_tokens` (refreshes if near-expiry to actually verify it still works), returns `{present, valid, expiresAt?, scope?, error?}` — gates the "Sync from Withings" button |
| `/api/withings/login-url` | Generates a fresh OAuth `state`, returns `{url}` for the dashboard to open in a popup |
| `/api/strava/status` | Same shape/logic as `/api/withings/status`, backed by `strava_tokens` |
| `/api/strava/login-url` | Same as Withings' — generates `state`, returns `{url}` for the popup |
| `/api/strava/callback` | OAuth redirect target — **on this same port 3001** (not a second permanent port like Withings' 3002), since Strava validates the callback *domain* registered in its API app settings, not an exact URL |
| `/api/activities/count?from=&to=` | `{count}` — activities in range (any source), no rows fetched. Used by the Delete card's live preview |
| `/api/body/count?from=&to=` | `{count}` — body measurements in range. Same use as above |
| `/api/activities/trash` | Soft-deleted, not-yet-purged activities (`id,filename,date_only,sport,distance_m,source,deleted_at`) — see "Soft delete & trash" |
| `/api/body/trash` | Soft-deleted, not-yet-purged body measurements (`id,measured_at,date_only,weight_kg,deleted_at`) |
| `/api/settings` | Current row from `settings` |
| `/api/settings/background-image` | Streams the current custom-uploaded background file (404 if `background_kind` isn't `'custom'` or the file is missing). Response has `Cache-Control: no-cache`; the frontend also cache-busts the URL with `?v=<background_value>` since the filename doesn't otherwise change when the setting does |

### DELETE
Soft delete only (see "Soft delete & trash") — these `UPDATE deleted_at`, they don't `DELETE` rows.
| Endpoint | Description |
|---|---|
| `/api/activities?from=&to=` | Soft-deletes activities in range (any source) |
| `/api/activity/:id` | Soft-deletes a single activity |
| `/api/body?from=&to=` | Soft-deletes body measurements in range |

### PUT
| Endpoint | Description |
|---|---|
| `/api/settings` | Body `{outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, min_trend_group_size}`, all required (the first three positive numbers, `outlier_min_speed_kmh` may be 0; `min_trend_group_size` an integer ≥ 2; 400 otherwise); updates the single `settings` row and returns it. `send()`/`sendNoContent()`'s CORS headers and the OPTIONS preflight handler all had to add `PUT` to `Access-Control-Allow-Methods` alongside the existing GET/POST/DELETE the first time this route was added |
| `/api/settings/theme` | Body `{theme}`, must be one of `THEME_NAMES` **or `'auto'`** (400 otherwise). Applied **immediately** on click in the Settings tab — unlike the outlier thresholds' explicit-Save pattern, appearance/units changes have no draft/save step |
| `/api/settings/background` | Body `{background_kind: 'none'\|'bundled', background_value?}` — selects a bundled preset or clears back to none. `background_value` required when `background_kind` is `'bundled'`. Uploading a custom image is a separate route (below), since that carries a binary body |
| `/api/settings/units` | Body `{unit_system}`, must be `'metric'`, `'imperial'`, or `'auto'` (400 otherwise). Same immediate-apply pattern as theme |
| `/api/settings/detail-view` | Body `{activity_detail_view}`, must be `'accordion'` or `'modal'` (400 otherwise). Same immediate-apply pattern as theme/units |

### POST
| Endpoint | Description |
|---|---|
| `/api/sync/garmin` | Spawns `sync-garmin.ts`, streams NDJSON progress events (`{type:"progress",phase,current,total,label}`), ends with `{type:"done",imported,skipped,errors}` or `{type:"error",message}` |
| `/api/sync/withings?from=&to=` | Spawns `sync-withings.ts` via `child_process.spawn` (passing `from`/`to` through as `--from`/`--to` CLI args if given), returns `{ imported, skipped, errors }` (blocking, single response). If `from`/`to` are omitted, the script falls back to its own default (since last synced measurement, or 2 years back on first run) |
| `/api/sync/strava?from=&to=` | Same pattern as Withings' sync route, spawns `sync-strava.ts`. `skipped` in the response folds in cross-source duplicates (see "Strava sync" below) |
| `/api/settings/background/upload?ext=jpg\|jpeg\|png\|webp\|gif` | Body is the **raw image bytes** (`Content-Type` set to the image's own mime type) — deliberately not `multipart/form-data`, since this app has zero runtime dependencies and a raw-body upload needs no parser at all (frontend just does `fetch(url, {method:"POST", body: file})`). Max 10MB. Writes to `garmin-stats/backgrounds/bg-<timestamp>.<ext>`, best-effort deletes the previous custom file (failure swallowed, not fatal), sets `background_kind='custom'` |
| `/api/activities/restore`, `/api/activities/purge` | Body `{ids: number[]}` (400 if empty/non-integers). Restore clears `deleted_at`; purge wipes the row's heavy data and sets `purged=1` — see "Soft delete & trash". Looped single-row prepared statements inside one transaction, not a dynamic `IN (...)` clause, so every bound value stays a real parameter |
| `/api/body/restore`, `/api/body/purge` | Same shape/semantics as the activities pair, for `body_measurements` |
