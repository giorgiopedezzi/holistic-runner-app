# Database schema & soft delete

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

## Database schema (SQLite)

### `activities`
| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `filename` | TEXT UNIQUE | original .FIT filename (Garmin) or `strava-<id>.json` synthetic name (Strava) — still the uniqueness key for both sources |
| `activity_date` | TEXT | ISO 8601 full timestamp |
| `date_only` | TEXT | `YYYY-MM-DD` — used for all range filters |
| `sport` | TEXT | running, cycling, walking, hiking, swimming, other |
| `duration_sec` | REAL | Total elapsed time including pauses (Garmin: session `total_elapsed_time`; Strava: `elapsed_time` — deliberately NOT `moving_time`, to keep this column's meaning consistent across sources) |
| `moving_time_sec` | REAL | Active/moving time excluding pauses (Garmin: session `total_timer_time`; Strava: `moving_time`). Nullable — null for rows inserted before this column existed and not yet reprocessed |
| `distance_m` | REAL | |
| `avg_pace_minkm` | REAL | min/km |
| `calories` | INTEGER | |
| `avg_hr` / `max_hr` | INTEGER | bpm |
| `avg_cadence` | INTEGER | steps/min |
| `ascent_m` / `descent_m` | REAL | Strava rows: `descent_m` always null — Strava's API doesn't expose total descent |
| `avg_speed_ms` / `max_speed_ms` | REAL | m/s |
| `source` | TEXT | `'garmin'` or `'strava'`, `NOT NULL DEFAULT 'garmin'`. Added via a migration in `initSchema()` (`PRAGMA table_info` check + `ALTER TABLE ADD COLUMN`, since `CREATE TABLE IF NOT EXISTS` doesn't alter existing tables) — the first schema migration this app has needed. Existing pre-migration rows correctly default to `'garmin'` |
| `deleted_at` / `purged` | TEXT / INTEGER | Soft delete — see "Soft delete & trash" below |

### `track_points`
Linked to `activities(id)` via CASCADE delete. Columns: `elapsed_sec`, `timestamp_unix`, `distance_m`, `heart_rate`, `speed_ms`, `cadence`, `altitude_m`, `temperature`, `power`, `lat`, `lon`. Populated from the FIT file for Garmin activities, from the Strava `streams` endpoint for Strava ones.
- `elapsed_sec` is FIT's per-record `elapsed_time` (Garmin) or Strava's `time` stream — a *moving/timer* clock. For Garmin it freezes (or increments more slowly — see the FIT parser notes) during an auto-pause; it is NOT reliable for detecting real stops on its own.
- `timestamp_unix` is real Unix wall-clock time, populated only for Garmin points parsed after this field was added (FIT record field 253). Always `NULL` for Strava (its `time` stream is elapsed-seconds-from-start, not absolute time — no source data for this column). Existing Garmin rows were backfilled once via `reprocess-fit-archive.ts`; any activity synced before that backfill and not yet reprocessed also has this `NULL`. `ActivityModal.tsx`'s pause detection uses `timestamp_unix` when every point on an activity has it, and falls back to a speed-based heuristic otherwise.

### `body_measurements`
Withings data. Key columns: `measured_at` (UNIQUE), `date_only`, `weight_kg`, `fat_ratio`, `fat_mass_kg`, `muscle_mass_kg`, `hydration_kg`, `bone_mass_kg`, `bmi`, `heart_rate`, plus `deleted_at` / `purged` (same soft-delete model as `activities`, see below).

### `withings_tokens` / `strava_tokens`
Identical shape, one row each (id=1). Columns: `access_token`, `refresh_token`, `expires_at` (unix seconds), `scope`.

### `settings`
Single global row (id=1), same pattern as `*_tokens`. Columns: `outlier_speed_delta_per_sec` (REAL, default 2.0), `outlier_cadence_delta_per_sec` (REAL, default 60.0) — max plausible change-per-second for Speed and Cadence, used by `ActivityModal.tsx`'s outlier filter (see below). Deliberately "change per second" (not a statistical parameter like a z-score) — a threshold a user can reason about directly ("speed can't jump 2 m/s in one second"), edited via the Settings tab. Also `outlier_min_speed_kmh` (REAL, default 6.0 ≈ 10:00 min/km) — an independent, absolute (not delta-based) floor: any Speed/Pace sample slower than this is dropped outright as "not really running," regardless of whether it looks like a spike; **always stored/labeled in km/h regardless of the unit system** — a deliberate scoping choice (it's an internal tuning threshold, not a measurement display). Plus appearance/units: `theme` (TEXT, default `'auto'` for fresh installs — see "Appearance" below for why existing installs don't retroactively get this — one of the 4 names in `types/api.ts`'s `THEME_NAMES`, or `'auto'`), `background_kind` (TEXT, default `'none'`, one of `'none' | 'bundled' | 'custom'`), `background_value` (TEXT, nullable — a bundled preset id, or an uploaded filename under `garmin-stats/backgrounds/`, depending on `background_kind`), `unit_system` (TEXT, default `'auto'`, one of `'metric' | 'imperial' | 'auto'`). Also `min_trend_group_size` (INTEGER, default 5 — see Overview tab below) and `activity_detail_view` (TEXT, default `'accordion'`, one of `'accordion' | 'modal'` — see Activities tab below). `initSchema()` seeds the row with `INSERT OR IGNORE` since column `DEFAULT`s only populate a row that gets inserted, not the table itself.

## Soft delete & trash
`activities` and `body_measurements` both have `deleted_at` (TEXT, nullable) and `purged` (INTEGER, default 0). Three states per row:
- **Active** — `deleted_at IS NULL`. Shows up everywhere normally; every read query in `server.ts` (`activities`, `activityById`, `summary`, `weekly`, `monthly`, `range`, `countInRange`, and the `body_*`/`correlation` equivalents) filters `deleted_at IS NULL`.
- **Trashed** — `deleted_at` set, `purged = 0`. What used to be a hard `DELETE` (`DELETE /api/activity/:id`, `DELETE /api/activities?from&to`, `DELETE /api/body?from&to`) now just sets `deleted_at`, an `UPDATE`. Fully intact, listed by `GET /api/activities/trash` / `GET /api/body/trash`, restorable via `POST /api/activities/restore` / `POST /api/body/restore` (`{ids: number[]}`, clears `deleted_at`).
- **Purged** — `purged = 1` (`deleted_at` stays set). "Empty the trash" (`POST /api/activities/purge` / `POST /api/body/purge`, same `{ids}` shape) — permanent, not restorable, and no longer listed by the trash endpoints. To actually reclaim space this wipes `track_points` (`DELETE FROM track_points WHERE activity_id = ?`) and every heavy/summary column (`distance_m`, `avg_hr`, `weight_kg`, etc. → `NULL`), but **deliberately keeps `filename` (activities) / `measured_at` (body_measurements)** — that's the load-bearing part: `sync-garmin.ts`'s dedup check (`SELECT filename FROM activities`, no `WHERE`) and `sync-withings.ts`'s `INSERT OR IGNORE` (keyed on `measured_at`'s `UNIQUE` constraint) both read/write unconditionally, so a purged row's surviving key is what stops a resync from silently reimporting something the user deliberately deleted. `sync-strava.ts`'s cross-source dedup check is the same story — it doesn't filter `deleted_at` either, so a trashed or purged activity still counts as "existing" and blocks a duplicate Strava import. **None of the three sync scripts needed any code changes** for this — the existing "read everything, ignore soft-delete state" queries already did the right thing by construction once `deleted_at`/`purged` existed.
- UI: `ManageTab.tsx`'s `TrashSection` (Data & Sync tab) lists both entity types with checkboxes, Restore / Delete-permanently (with a confirm step, same pattern as the Delete card above it).
