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
| `activity_type_id` | INTEGER | FK to `activity_types(id)`, `NOT NULL DEFAULT 1` (Training). Set via `PUT /api/v1/activities/:id/type`; only a type whose `min_distance_m` is ≤ the activity's own `distance_m` may be assigned. No `REFERENCES` clause on this column specifically — SQLite's `ALTER TABLE ADD COLUMN` rejects a `REFERENCES` column paired with a non-`NULL` `DEFAULT`, so the FK is enforced application-side (the controller looks up the type before writing) rather than schema-side |
| `activity_name` | TEXT | Nullable free-text label set alongside `activity_type_id` (e.g. a race's name, "Boston Marathon 2026"). Shown on the Activities tab's row when present |

### `activity_types`
Fixed reference lookup, read-only via `GET /api/v1/activity-types`. Seeded with explicit ids (not autoincrement) so `activities.activity_type_id`'s column `DEFAULT` can point at a literal: `1` Training (`min_distance_m` 0) · `2` Race 5km (5000) · `3` Race 10km (10000) · `4` Half-Marathon (21097.5) · `5` Marathon (42195). `min_distance_m` gates which types a given activity may be tagged as — see `activities.activity_type_id` above.

### `track_points`
Linked to `activities(id)` via CASCADE delete. Columns: `elapsed_sec`, `timestamp_unix`, `distance_m`, `heart_rate`, `speed_ms`, `cadence`, `altitude_m`, `temperature`, `power`, `lat`, `lon`. Populated from the FIT file for Garmin activities, from the Strava `streams` endpoint for Strava ones.
- `elapsed_sec` is FIT's per-record `elapsed_time` (Garmin) or Strava's `time` stream — a *moving/timer* clock. For Garmin it freezes (or increments more slowly — see the FIT parser notes) during an auto-pause; it is NOT reliable for detecting real stops on its own.
- `timestamp_unix` is real Unix wall-clock time, populated only for Garmin points parsed after this field was added (FIT record field 253). Always `NULL` for Strava (its `time` stream is elapsed-seconds-from-start, not absolute time — no source data for this column). Existing Garmin rows were backfilled once via `reprocess-fit-archive.ts`; any activity synced before that backfill and not yet reprocessed also has this `NULL`. `ActivityModal.tsx`'s pause detection uses `timestamp_unix` when every point on an activity has it, and falls back to a speed-based heuristic otherwise.

### `body_measurements`
Withings data. Key columns: `measured_at` (UNIQUE), `date_only`, `weight_kg`, `fat_ratio`, `fat_mass_kg`, `muscle_mass_kg`, `hydration_kg`, `bone_mass_kg`, `bmi`, `heart_rate`, plus `deleted_at` / `purged` (same soft-delete model as `activities`, see below).

### `withings_tokens` / `strava_tokens`
Identical shape, one row each (id=1). Columns: `access_token`, `refresh_token`, `expires_at` (unix seconds), `scope`.

### `settings`
Single global row (id=1), same pattern as `*_tokens`. Columns: `outlier_speed_delta_per_sec` (REAL, default 2.0), `outlier_cadence_delta_per_sec` (REAL, default 60.0) — max plausible change-per-second for Speed and Cadence, used by `ActivityModal.tsx`'s outlier filter (see below). Deliberately "change per second" (not a statistical parameter like a z-score) — a threshold a user can reason about directly ("speed can't jump 2 m/s in one second"), edited via the Settings tab. Also `outlier_min_speed_kmh` (REAL, default 6.0 ≈ 10:00 min/km) — an independent, absolute (not delta-based) floor: any Speed/Pace sample slower than this is dropped outright as "not really running," regardless of whether it looks like a spike; **always stored/labeled in km/h regardless of the unit system** — a deliberate scoping choice (it's an internal tuning threshold, not a measurement display). Plus appearance/units: `theme` (TEXT, default `'auto'` for fresh installs — see "Appearance" below for why existing installs don't retroactively get this — one of the 4 names in `types/api.ts`'s `THEME_NAMES`, or `'auto'`), `background_kind` (TEXT, default `'none'`, one of `'none' | 'bundled' | 'custom'`), `background_value` (TEXT, nullable — a bundled preset id, or an uploaded filename under `garmin-stats/backgrounds/`, depending on `background_kind`), `unit_system` (TEXT, default `'auto'`, one of `'metric' | 'imperial' | 'auto'`). Also `min_trend_group_size` (INTEGER, default 5 — see Overview tab below) and `activity_detail_view` (TEXT, default `'accordion'`, one of `'accordion' | 'modal'` — see Activities tab below). Also `date_format` (TEXT, default `'literal_uk'`, one of `'numeric_uk' | 'numeric_us' | 'literal_uk' | 'literal_us'`) — how every displayed date renders app-wide (`garmin-dashboard`'s `utils/fmt.ts` `fmtDate`): style (numeric `23/03/2026` vs literal `23 Mar 2026`) × region (uk day-first vs us month-first). Independent of `unit_system` — a UK date format doesn't imply metric units. `initSchema()` seeds the row with `INSERT OR IGNORE` since column `DEFAULT`s only populate a row that gets inserted, not the table itself.

### `date_ranges`
Named date ranges the user saves for later recall/comparison (Data & Sync tab's "Named date ranges"
card) — mainly for comparing training blocks, e.g. week 2 vs week 3 of marathon prep, or one race's
build-up vs another's. Columns: `id`, `name` (`UNIQUE` — a duplicate save is rejected with `409`, never
silently overwritten), `from_date`/`to_date` (`YYYY-MM-DD`), `created_at`. `activity_id` (nullable, FK
to `activities(id)`) optionally links the race the block led up to — **one activity can be the target
of many date ranges** (e.g. separate "week 2"/"week 3" blocks both pointing at the same race), so
there's no `UNIQUE` on `activity_id`. Validated in `date-ranges.controller.ts` at save time: the linked
activity must be race-typed (`activity_type_id != 1`) and its `date_only` must be strictly *after* the
range's `to_date` — never before or during it. `GET /api/v1/date-ranges` `LEFT JOIN`s `activities` so a
list read carries the linked race's display fields (`race_date_only`, `race_activity_name`,
`race_distance_m`, `race_activity_type_id`, all `NULL` when `activity_id` is `NULL`) without a second
round trip. `GET /api/v1/activities/races` (all activities with `activity_type_id != 1`, full history,
no date filter) feeds the "link a race" dropdown on the save form; the frontend filters that list to
`date_only > to` client-side as the form's `to` date changes.

### `plan_templates` / `plan_instances` / `plan_instance_days`
Persistence for the RunPlan DSL v1 (`docs/runplan-dsl.md`, HRA-111/HRA-112). A **template** is a
reusable, parsed-but-**unresolved** plan (pace stays symbolic — an anchor name, not a number —
until instantiated); an **instance** is one concrete, resolved application of a template to a
specific race.

`plan_templates`: `id`, `name`, `dsl_source` (TEXT, the original DSL text — kept so a structural
edit can be re-parsed later), `parsed_plan` (TEXT, JSON-serialized pre-resolution `RunPlan` from
`domain/runplan/parser.ts`), `event` (from `PlanMetadata.event`), `approved_at` (nullable TEXT —
HRA-113 gate 2, see below), `created_at`. A template can only be saved if its DSL parses
(`ParseResult.ok`) **and** has zero outstanding warnings anywhere in the tree (HRA-113 — replaces
HRA-111's bottom-up `valid`/`errors` model, which no longer exists: nothing the parser encounters is
a hard error anymore) — `POST`/`PUT` reject with 422 otherwise, walking the whole section→week→day
tree to report every flagged day's own warnings plus any plan-scoped ones (unrecognized lines,
circular pace refs).

**Two independent save gates (HRA-113):** **gate 1** (automatic) is the zero-warning check above —
it governs whether `POST`/`PUT` succeed at all. **Gate 2** (`approved_at`, deliberate) is a
separate, human-triggered sign-off via `POST /api/v1/plan-templates/:id/approve` — `NULL` means not
approved. **Any subsequent `PUT`, even one that still results in zero warnings, clears `approved_at`
back to `NULL`** (handled inside the repo's `UPDATE` statement) — approval means "a human signed off
on this exact saved state," not "this happens to currently parse cleanly." A separate
`POST /api/v1/plan-templates/generate` endpoint runs the same parse (returning the `RunPlan` with
its per-day warnings) without persisting anything — what a review UI calls on every edit before the
user is ready to save.

`plan_instances`: `id`, `template_id` (FK to `plan_templates(id)`, **ON DELETE CASCADE**),
`start_date` (the instantiation-time plan start), `pace_overrides` (nullable TEXT, JSON-serialized
`PacePolicy` — kept for provenance: what was actually overridden to produce this instance),
`target_activity_id` (nullable FK to `activities(id)` — the race this instance targets, validated
**exactly** like `date_ranges.activity_id` above: race-typed, `date_only` strictly after the
instance's last resolved day), `approved_at` (nullable TEXT, same gate-2 semantics as
`plan_templates.approved_at` — set via `POST /api/v1/plan-instances/:id/approve`, cleared by any
subsequent `PUT /api/v1/plan-instances/:id`), `name` (nullable TEXT — HRA-114: the instance's own
name, genuinely distinct from its source template's, e.g. template "Albanesi 12 weeks training plan"
→ instance "...for Boston 2028"; required by the application on create/`PUT`, nullable at the DB
level only because a migration can't invent a real name for pre-existing rows), `event` (nullable
TEXT — HRA-114: a denormalized copy of the template's `event` at instantiation time, for read
convenience; never independently settable, always the same event type as its template), `created_at`.

**`name`/`event` migration (HRA-114):** rows created before this Story had neither column. The
migration backfills them from the source template (`name` ← template's `name`, `event` ← template's
`event`) via a joined `UPDATE`, so no pre-existing instance is left with a `NULL name` — the
backfilled value is a placeholder, editable afterward via `PUT`.

**Instantiation requires a `name` (HRA-114):** `POST /api/v1/plan-templates/:id/instantiate`'s
request body requires `name` (string, 422 if missing/blank) — the instance's own name. `event` is
never a request parameter; it's always auto-populated as a denormalized copy of the template's
`event` at creation time.

**Instantiation-time pace input (HRA-113):** the instantiate call accepts pace anchors two ways —
`pace_overrides` (explicit `PacePolicy`-shaped values, as before) or a `goal_time` (`HH:MM:SS`),
converted to the `RG` anchor via `goal_time_sec / (distance_m / 1000)`. The distance used is, in
order: an explicit `distance_m` on the instantiate call, then the template's own `DISTANCE`
metadata, then the event's fixed standard distance (5k/10k/half/marathon, mirroring
`activity_types.min_distance_m`'s seed values). `ultra`/`custom` events have no standard distance,
so a `goal_time` for those events requires an explicit `distance_m` on the instantiate call — a 422
otherwise. Supplying both `goal_time` and an explicit `RG` in `pace_overrides` is rejected as
ambiguous.

**Editing an instance (HRA-113, extended HRA-114, HRA-115):** `PUT /api/v1/plan-instances/:id`
replaces the instance's `name` and resolved days wholesale (`{name, days: [...]}`). `name` is
required (422 if missing/blank); `event` is never accepted here — read-only/derived from the
template. **Each day now carries its raw DSL text** (`{section_name, week_number, date, dsl}`,
`dsl` the same D-line grammar as a template, e.g. `"D3 [interval]: 4x3000m @ RG-20 r:1km @ RG+10"`)
**instead of pre-resolved segments (HRA-115, reopening HRA-113's "structured JSON, not DSL text"
call now that a real editor UI exists to build a text-edit contract against)**. For each day, the
backend looks up that day's section/week in the source template's own parsed plan to find the
effective `PacePolicy` for that scope, merges in the instance's own `pace_overrides` at plan level
(same precedence `instantiatePlan` itself applies), calls `parseDayEntry(dsl, ctx)` against that
policy, and resolves the parsed day the same way `instantiatePlan` resolves a segment
(`domain/runplan/instantiate.ts`'s exported `resolveDay`). Gated the same way as a template save:
any day whose fresh parse still carries a warning (`needs_review: true`) is rejected with 422,
listing every flagged day — derived from the parse itself now, not a client-supplied flag. Editing
an instance **never** touches or re-instantiates its source template — an instance is an
independent artifact once created, and is allowed to diverge from what the template would currently
produce.

**Deleting an instance (HRA-115):** `DELETE /api/v1/plan-instances/:id` — hard delete, no trash,
same reasoning as `plan_templates`' delete. `ON DELETE CASCADE` (`plan_instance_days.instance_id`)
removes the instance's days too. 204 on success, 404 if the instance doesn't exist.

`plan_instance_days`: one row per resolved day, `instance_id` FK to `plan_instances(id)` **ON
DELETE CASCADE**. Columns: `id`, `section_name`, `week_number`, `date` (concrete `YYYY-MM-DD`,
derived per the week-date rule below), `day`, `suffix`, `category`, `workout_type`, `segments`
(TEXT, JSON-serialized `ResolvedSegment[]` from `domain/runplan/instantiate.ts` — preserves every
segment on a multi-segment day and the DSL's real segment shapes, continuous/interval/progression/
rest_block, each carrying resolved `*_sec_per_km` pace values instead of symbolic anchors —
deliberately **not** flattened to one distance/pace pair per day), `activity_target`,
`activity_description`, `notes`, `needs_review` (0/1 — a day is flagged if it already was at parse
time, or if any of its resolved intensities failed to resolve against the overridden policy).

**Week-date derivation rule** (confirmed at Refinement for HRA-112): `week.start_date =
instantiation_start_date + (week.number - 1) × 7 days`, **unless** that week already carries an
explicit `WEEK ... START <date>` in the template's own DSL source, in which case the explicit date
wins. Implemented in `domain/runplan/instantiate.ts`'s `instantiatePlan()`.

## Soft delete & trash
`activities` and `body_measurements` both have `deleted_at` (TEXT, nullable) and `purged` (INTEGER, default 0). Three states per row:
- **Active** — `deleted_at IS NULL`. Shows up everywhere normally; every read query in `server.ts` (`activities`, `activityById`, `summary`, `weekly`, `monthly`, `range`, `countInRange`, and the `body_*`/`correlation` equivalents) filters `deleted_at IS NULL`.
- **Trashed** — `deleted_at` set, `purged = 0`. What used to be a hard `DELETE` (`DELETE /api/activity/:id`, `DELETE /api/activities?from&to`, `DELETE /api/body?from&to`) now just sets `deleted_at`, an `UPDATE`. Fully intact, listed by `GET /api/activities/trash` / `GET /api/body/trash`, restorable via `POST /api/activities/restore` / `POST /api/body/restore` (`{ids: number[]}`, clears `deleted_at`).
- **Purged** — `purged = 1` (`deleted_at` stays set). "Empty the trash" (`POST /api/activities/purge` / `POST /api/body/purge`, same `{ids}` shape) — permanent, not restorable, and no longer listed by the trash endpoints. To actually reclaim space this wipes `track_points` (`DELETE FROM track_points WHERE activity_id = ?`) and every heavy/summary column (`distance_m`, `avg_hr`, `weight_kg`, etc. → `NULL`), but **deliberately keeps `filename` (activities) / `measured_at` (body_measurements)** — that's the load-bearing part: `sync-garmin.ts`'s dedup check (`SELECT filename FROM activities`, no `WHERE`) and `sync-withings.ts`'s `INSERT OR IGNORE` (keyed on `measured_at`'s `UNIQUE` constraint) both read/write unconditionally, so a purged row's surviving key is what stops a resync from silently reimporting something the user deliberately deleted. `sync-strava.ts`'s cross-source dedup check is the same story — it doesn't filter `deleted_at` either, so a trashed or purged activity still counts as "existing" and blocks a duplicate Strava import. **None of the three sync scripts needed any code changes** for this — the existing "read everything, ignore soft-delete state" queries already did the right thing by construction once `deleted_at`/`purged` existed.
- UI: `ManageTab.tsx`'s `TrashSection` (Data & Sync tab) lists both entity types with checkboxes, Restore / Delete-permanently (with a confirm step, same pattern as the Delete card above it).
