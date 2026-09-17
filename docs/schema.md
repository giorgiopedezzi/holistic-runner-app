# Database schema & soft delete

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

## Database schema (SQLite)

## Identity domain (PostgreSQL — HRA-348)

Persisted by `db/migrations/003_identity_domain.sql` on top of `users`/`external_identities`
from `001_postgresql_foundation.sql`. Domain/persistence models only — see
`docs/architecture/AUTHENTICATION-TENANCY-ADR.md` for the full authentication design; no
login/callback HTTP route exists yet, and nothing here is wired into the existing single-tenant
(`FOUNDER_USER_ID`) controllers.

### `users`
The internal, stable Runs Free identity (AC1). `id` (UUID) is immutable and non-enumerable —
never derived from an email or provider identifier (see `db/founder.ts`'s `FOUNDER_USER_ID`
for the existing precedent). `display_name`/`locale`/`unit_system`/`timezone` are nullable
profile fields (unset until a real login flow collects them) — deliberately **not** the same
column as `user_settings.timezone`/`unit_system`/`language`, which remain the app's *display
preference* store; the two aren't reconciled by this Story (see the HRA-348 review comment).
`timezone` is validated app-side via `domain/plan-timezone.ts`'s `isValidIanaTimeZone`, not a DB
CHECK. `status` (`active | disabled | deletion_pending`, default `active`) is enforced before
private controller logic by `services/identity.service.ts`'s session/token validation (AC8).
`role` (`user | admin`, default `user`) is intentionally coarse — feature/subscription
capabilities live in `user_entitlements` instead (AC9), and no code path lets `role` substitute
for per-resource ownership (AC10, see `domain/identity/authorization.ts`'s `ownsResource`).

### `external_identities`
Unique by `(issuer, subject)` — the only authoritative identity key (AC2). `provider` and
`email_at_link_time` are non-authoritative metadata: a provider email change updates
`email_at_link_time` in place and never touches the owning `users` row (AC3). Two different
`(issuer, subject)` pairs sharing the same email are never merged (AC4) —
`repositories/identity.repo.ts`'s `findExternalIdentity` only ever looks up by the pair, never
by email.

### `sessions`
Opaque session state (AC6): `id` is a non-secret lookup key; `secret_hash` is a SHA-256 digest
of the bearer secret the caller holds — the raw secret is never persisted, only ever returned
once at issuance (`domain/identity/session-lifecycle.ts`). `idle_expires_at`/
`absolute_expires_at` are tracked independently so idle renewal can never extend a session past
its absolute lifetime (ADR: 30 min idle / 12h absolute, `AUTH_SESSION_IDLE_SECONDS`/
`AUTH_SESSION_ABSOLUTE_SECONDS`). Successful authentication always rotates: the previous session
is revoked and a new `(id, secret)` pair is issued, preventing fixation (AC7).

### `user_entitlements`
Feature/subscription capabilities, keyed `(user_id, entitlement)` — deliberately separate from
`users.role` (AC9) so entitlements can be granted/revoked without touching the role boundary.
HRA-360 seeds only the deterministic founder with `can_publish_profile`; MVP publication also
requires that deterministic founder identity, so ordinary accounts remain non-public by default.

### `security_events`
The minimum useful authentication/session lifecycle facts (AC13): `event_type`, the acting
`user_id` (nullable — e.g. a denied registration for an unknown identity has none),
`external_issuer`/`external_subject` (safe, non-secret identifiers), and a short `detail` label.
This table must never receive credentials, provider tokens, raw FIT data, or training payloads.

## Public projection (PostgreSQL — HRA-359)

`public_projection_sources` is the private control row connecting one owner to
an opaque public slug and explicit `draft | published | suspended` state.
`public_projection_identifiers` preserves stable random UUIDs without placing
private resource ids in public JSON. `public_projection_snapshots` atomically
stores one last-known-safe JSONB snapshot plus a hashed source version,
freshness, and private retry metadata.

Anonymous readers use only the `published_public_projections` view. Its columns
are `public_slug`, `source_version`, `payload`, and `projected_at`; it contains
no owner/source ids and returns no row for draft, suspended, or never-successful
projections. See `docs/architecture/PUBLIC-PROJECTION-ADR.md` for the allowlist,
redaction, idempotency, and fail-closed contract.

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
| `system_classification` / `system_explanation` | TEXT | Latest persisted deterministic Runs Free result and explanation. Reclassification updates this pair without touching a manual override. |
| `manual_classification` | TEXT | Nullable human override. When present this is the effective displayed category; clearing it reveals the stored system result without recomputing. Migration 009 derives it from earlier rejected/final corrections and backfills the system pair from the earlier classification slots. |
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
Athlete classification inputs live on the owner-scoped `user_settings` row and are nullable: `current_easy_pace_sec_per_km` and `current_race_pace_sec_per_km` store positive integer seconds per kilometre; `current_long_run_target_m` stores positive integer metres. Display-unit changes never rewrite these canonical values.

Single global row (id=1), same pattern as `*_tokens`. Columns: `outlier_speed_delta_per_sec` (REAL, default 2.0), `outlier_cadence_delta_per_sec` (REAL, default 60.0) — max plausible change-per-second for Speed and Cadence, used by `ActivityModal.tsx`'s outlier filter (see below). Deliberately "change per second" (not a statistical parameter like a z-score) — a threshold a user can reason about directly ("speed can't jump 2 m/s in one second"), edited via the Settings tab. Also `outlier_min_speed_kmh` (REAL, default 6.0 ≈ 10:00 min/km) — an independent, absolute (not delta-based) floor: any Speed/Pace sample slower than this is dropped outright as "not really running," regardless of whether it looks like a spike; **always stored/labeled in km/h regardless of the unit system** — a deliberate scoping choice (it's an internal tuning threshold, not a measurement display). Plus appearance/units: `theme` (TEXT, default `'auto'` for fresh installs — see "Appearance" below for why existing installs don't retroactively get this — one of the 4 names in `types/api.ts`'s `THEME_NAMES`, or `'auto'`), `background_kind` (TEXT, default `'none'`, one of `'none' | 'bundled' | 'custom'`), `background_value` (TEXT, nullable — a bundled preset id, or an uploaded filename under `garmin-stats/backgrounds/`, depending on `background_kind`), `unit_system` (TEXT, default `'auto'`, one of `'metric' | 'imperial' | 'auto'`). Also `timezone` (TEXT, nullable — HRA-332: the owner-configured IANA timezone, `PUT /api/v1/settings/timezone`; `NULL` means "not yet configured," the documented trigger for `plan_instances.schedule_timezone`'s own `'UTC'` creation/backfill fallback — see that column's own comment above — deliberately no column `DEFAULT`, since a `DEFAULT` would silently imply a real configured value that was never actually chosen). Also `min_trend_group_size` (INTEGER, default 5 — see Overview tab below) and `activity_detail_view` (TEXT, default `'accordion'`, one of `'accordion' | 'modal'` — see Activities tab below). Also `date_format` (TEXT, default `'literal_uk'`, one of `'numeric_uk' | 'numeric_us' | 'literal_uk' | 'literal_us'`) — how every displayed date renders app-wide (`garmin-dashboard`'s `utils/fmt.ts` `fmtDate`): style (numeric `23/03/2026` vs literal `23 Mar 2026`) × region (uk day-first vs us month-first). Independent of `unit_system` — a UK date format doesn't imply metric units. `initSchema()` seeds the row with `INSERT OR IGNORE` since column `DEFAULT`s only populate a row that gets inserted, not the table itself.

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
`domain/runplan/parser.ts`), `event`, `approved_at` (nullable TEXT —
HRA-113 gate 2, see below), `created_at`. A template can only be saved if its DSL parses
(`ParseResult.ok`) **and** has zero outstanding warnings anywhere in the tree (HRA-113 — replaces
HRA-111's bottom-up `valid`/`errors` model, which no longer exists: nothing the parser encounters is
a hard error anymore) — `POST`/`PUT` reject with 422 otherwise, walking the whole section→week→day
tree to report every flagged day's own warnings plus any plan-scoped ones (unrecognized lines,
circular pace refs).

**`event`/`distance_m` are explicit request fields, not DSL text (HRA-120):** `POST`/`PUT
/api/v1/plan-templates` require `event` (one of `5k | 10k | half | marathon | custom`) and, iff
`event === "custom"`, `distance_m` (rejected with 422 if supplied for any other event). The
controller sets `plan.metadata.event`/`plan.metadata.distance_m` from these fields **after**
parsing, unconditionally overwriting whatever the DSL's now-vestigial `EVENT`/`DISTANCE` lines
produced — `distance_m` still lives inside `parsed_plan.metadata.distance_m` (no dedicated column),
just sourced from the request now. `PLAN`, `NAME`, plan-level `START`, `GOAL`, and
`EVENT`/`EVENT_TYPE`/plan-level `DISTANCE` are all optional and vestigial in the DSL grammar itself
— see `docs/runplan-dsl.md`.

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
convenience; never independently settable, always the same event type as its template), `race_name`
/ `race_date` / `race_url` (nullable TEXT — HRA-121: the instance's own free-text description of the
race it targets, all optional and independent of `target_activity_id` — a race that hasn't happened
yet may have no linkable activity row at all. `race_url` is a plain free-text link, e.g. the race's
registration page — not validated as a well-formed URL server-side, same "trust the user" treatment
as `race_name`), `schedule_timezone` (nullable TEXT, an IANA identifier — see "Schedule timezone
& Original baseline" below), `original_start_date` / `original_days_snapshot` (same section),
`created_at`.

**Schedule timezone & Original baseline (HRA-332):** `schedule_timezone` governs plan-date
interpretation, activity local-date conversion, report `asOf` boundaries, and missed-workout
eligibility for this instance. Set at creation from an explicit request value, else the
owner-configured `settings.timezone`, else a request-supplied `browser_timezone_fallback`
(creation-time-only), else the literal `'UTC'` (so `POST .../instantiate` stays non-breaking for a
caller that sends none of these). Freely correctable via `PATCH /api/v1/plan-instances/:id`
(`{schedule_timezone}`) until Original freezes, then rejected with 409.

`original_start_date` / `original_days_snapshot` (nullable TEXT, JSON — same per-day shape as
`plan_instance_days`, without `id`/`instance_id`) are the Original baseline: mirrored from Current
on every pre-freeze mutation (`instantiate`, `PATCH .../plan-instances/:id` fields/days/
schedule_timezone, `PATCH .../days/:dayId`, `POST .../regenerate`) and left untouched forever once
frozen. Freeze is `domain/plan-timezone.ts`'s `isOriginalFrozen()` — a pure function of (today's
local calendar date in `schedule_timezone`) >= `original_start_date` — recomputed on every mutation
attempt rather than a stored flag flipped by a scheduled job, so an instance created with a
past `start_date` freezes immediately on its first write with no scheduler involved, and moving
`start_date` later can never unfreeze it (the frozen boundary itself never moves backward once
"today" has passed it). A whole-instance JSON snapshot was chosen over a second mirrored
`plan_instance_days`-shaped table: nothing yet queries Original at day granularity (the report
feature that will is Epic HRA-331, not started), and the snapshot is trivially kept in lockstep
pre-freeze; a mirrored table is the more invasive alternative if a real per-day Original query need
ever appears. **Backfill:** pre-HRA-332 rows get `schedule_timezone` from the owner's
`settings.timezone` (or `'UTC'` if that was never configured either) and `original_start_date`/
`original_days_snapshot` set to their current `start_date`/days — "Current is Original" is the only
sane one-time value for legacy rows, since no prior Original ever existed to recover.

**Minimal plan-revision contract (HRA-336):** `current_revision`/`original_revision` (INTEGER,
`NOT NULL DEFAULT 1`) are the durable revision pair a report reads to prove which mutable Current
state (and which frozen Original snapshot) it actually saw. `current_revision` is bumped by exactly
1, inside the same transaction as the mutation itself, by every successful SEMANTIC mutation of
Current (`plan-instances.service.ts`'s `patchInstance`/`patchDay`/`regenerateFrom`) — a failed
operation rolls the whole transaction back (nothing to undo), and a semantic no-op (the request
resends exactly what's already persisted) is detected by `domain/plan-revision.ts` and never bumps at
all. `original_revision` mirrors `current_revision` in lockstep while Original still mirrors Current
(pre-freeze, the same `syncOriginalIfNotFrozen` write path HRA-332 already uses) and then stops
changing forever once the Original baseline freezes — same "mirror until frozen" split
`original_start_date`/`original_days_snapshot` already have. Both start at 1 at creation (`instantiate`
never calls the bump — a fresh instance's revision 1 is simply its starting state) and both existing
pre-HRA-336 rows are migrated to 1/1 via `ALTER TABLE ADD COLUMN ... DEFAULT 1` (no backfill loop
needed, unlike `workout_id`'s per-row migration below — a single shared constant is correct here since
there is no earlier revision history to recover). A report's own consistent read boundary
(`services/reporting.service.ts`) reads the instance row (carrying both revisions) and every other
input it needs in one synchronous call with no `await` in between — Node's single-threaded,
synchronous-`node:sqlite` execution model makes that boundary atomic by construction, so a report can
never mix Current content from one revision with a different reported revision.

**`name`/`event` migration (HRA-114):** rows created before this Story had neither column. The
migration backfills them from the source template (`name` ← template's `name`, `event` ← template's
`event`) via a joined `UPDATE`, so no pre-existing instance is left with a `NULL name` — the
backfilled value is a placeholder, editable afterward via `PUT`.

**Instantiation requires a `name` (HRA-114):** `POST /api/v1/plan-templates/:id/instantiate`'s
request body requires `name` (string, 422 if missing/blank) — the instance's own name. `event` is
never a request parameter; it's always auto-populated as a denormalized copy of the template's
`event` at creation time.

**Instantiation-time pace input (HRA-113, distance source updated HRA-120, anchor generalized
HRA-121):** the instantiate call accepts pace anchors two ways — `pace_overrides` (explicit
`PacePolicy`-shaped values, as before) or a `goal_time` (`HH:MM:SS`) paired with a **required**
`race_pace_anchor` naming which anchor it resolves to (`goal_time_sec / (distance_m / 1000)`) — no
default; `race_pace_anchor` was hardcoded to `RG` before HRA-121, so a `goal_time` request without it
is now rejected (422) rather than silently assuming `RG`. The distance used is, in order: an
explicit `distance_m` on the instantiate call, then the template's own `distance_m` (HRA-120: always
set on a `custom`-event template, from its create/update request body — no longer a DSL `DISTANCE`
line), then the event's fixed standard distance (5k/10k/half/marathon, mirroring
`activity_types.min_distance_m`'s seed values). `custom` has no standard distance, but since
`distance_m` is mandatory at save time for a `custom`-event template, a `goal_time` call for one
always has a distance to fall back to without supplying `distance_m` explicitly — the
instantiate-call override still exists for a race with a different distance than the template's own.
Supplying both `goal_time` and an explicit `pace_overrides` value for the same `race_pace_anchor` is
rejected as ambiguous.

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
time, or if any of its resolved intensities failed to resolve against the overridden policy),
`scheduled_time` (TEXT, `HH:MM`, nullable — HRA-149: a `NULL` reads as the 08:00 default at display
time only, never backfilled onto pre-existing rows. Set via `PATCH /api/v1/plan-instances/:id/days/:dayId`,
the per-day sibling of the bulk `PATCH /api/v1/plan-instances/:id`'s wholesale `days` replace — a
smaller, more honest write for editing one field on one already-existing day. That endpoint's body,
`{dsl?, notes?, scheduled_time?}`, validates each field independently and is rejected with 409 once
the instance is approved, mirroring HRA-126's intended "editable only until approved" lock, which the
earlier Story enforced client-side only), `customized_at` (TEXT, nullable timestamp — HRA-299: a
day-level customization provenance marker, same "NULL means not set" gate convention as
`plan_templates.approved_at`/`plan_instances.approved_at`. Set by `PATCH .../days/:dayId`'s `dsl`
branch only — a notes-only or scheduled_time-only patch never sets it, since neither touches the
day's actual workout content — and intended to also be set on both sides of a day swap once a swap
mutation exists (currently none does; the existing desktop swap is local-only until the whole-day
bulk Save, see below). Every row a bulk `days` replace or a `/regenerate` call produces starts back
at `NULL` regardless of what the row it replaces carried — both recreate the row from scratch via
`deleteDayByIdentity`/`deleteDaysByInstance` + a fresh insert, so "customized" is only ever
meaningful relative to a day's own currently-persisted row, never carried forward through either of
those two wholesale-replace paths (bulk editing is explicitly out of this Story's scope). `POST
.../regenerate`'s own preflight (below) is what protects a customized day from silently reaching
that fresh-insert path without confirmation). `workout_id` (TEXT — HRA-333: this planned
workout's stable identity, independent of `id`) — see the dedicated paragraph below.

**Stable workout identity & Original-to-Current lineage (HRA-333):** `plan_instance_days.workout_id`
is a planned workout's identity independent of the row's own primary key and of its date/day/week/
section placement — the primary key is bound to a physical row/slot (an `UPDATE` keeps it, a
delete+recreate does not), while `workout_id` travels with the *session itself* so a day/week swap,
a section move, or a regenerate is never read as an unrelated Original removal plus Current addition
when the intended workout survives. Assigned once per workout and never changed by an ordinary
`UPDATE` (`PATCH .../days/:dayId`'s `dsl`/`notes`/`scheduled_time` edits): **instantiate** mints a
fresh id per day (nothing to inherit yet); **regenerate** carries a slot's previous occupant's id
over to the freshly regenerated row replacing it, keyed by the same `(section_name, week_number,
day)` tuple `deleteDayByIdentity` already treats as "this slot" (a slot with no previous occupant —
a template DSL change introducing a new day — mints a fresh one); the **bulk days-replace**
(`PATCH /api/v1/plan-instances/:id`) accepts an optional `workout_id` per day in the request body
and echoes it back only when it names one of that instance's own *current* days (never trusted
blindly — a stale or cross-instance value is silently replaced with a fresh id instead), which is
how a day/week swap (the frontend exchanges `workout_id` alongside `dsl` between the two swapped
slots) survives the wholesale delete+recreate. **A live swap** (`AgendaTab.tsx`,
`MobileWorkoutSwap.tsx` — as opposed to the desktop drag-swap's local-only edit, staged until the
next bulk Save above) no longer persists via two separate single-day `PATCH .../days/:dayId` calls:
each call was its own transaction, so `plan_instance_days`' own `(instance_id, workout_id)` unique
constraint — `DEFERRABLE INITIALLY IMMEDIATE` precisely so one statement can exchange two rows'
`workout_id` without transiently violating it mid-statement — could never actually resolve, since
the first call's row still collided with the second (as yet untouched) row at *that call's own*
commit. **`POST /api/v1/plan-instances/:id/workouts/swap`** (HRA-333 follow-up) replaces that
workaround: one transaction locks both slot rows, verifies both exist and belong to the requested
instance (404 + full rollback otherwise), defers the constraint, and exchanges `workout_id` between
them in one statement — real same-instance verification, not the trusted-as-given shortcut the old
per-day PATCH accepted for this case. `domain/runplan/lineage.ts`'s
`classifyWorkoutLineage(originalDays, currentDays)` — pure, no I/O — matches Original's
`original_days_snapshot` days to Current's `plan_instance_days` rows by `workout_id` and classifies
each as `unchanged | moved | modified | moved_and_modified | removed | added`: **moved** compares the
structural `(section_name, week_number, day)` slot, deliberately not the absolute `date` (which
shifts for every *unmoved* workout on a plain start-date regenerate); **modified** compares parsed
structural content (`segments`/`activity_target` JSON-parsed, not string-compared) so a cosmetic
re-serialization never counts as a change. Consumed by a future report Story (Epic HRA-331) — this
Story owns only the identity + classification, not any endpoint or UI. **Migration:** every
pre-existing `plan_instance_days` row is backfilled with its own fresh, independent id (there is no
earlier lineage to recover); every pre-existing `original_days_snapshot`'s day objects are backfilled
by matching each to its Current counterpart on that same `(section_name, week_number, day)` tuple and
inheriting that row's freshly minted id — a snapshot day with no such match (already removed from
Current since freeze) gets its own independent fresh id instead.

**Week-date derivation rule** (confirmed at Refinement for HRA-112, amended HRA-124): `week.start_date
= trueMonday + (week.number - 1) × 7 days`, **unless** that week already carries an explicit
`WEEK ... START <date>` in the template's own DSL source, in which case the explicit date wins.
**`trueMonday` (HRA-124):** `instantiation_start_date` is the calendar date of `K0` — the lowest
D-number the template's week 1 actually declares, not necessarily `D1` — so `trueMonday =
instantiation_start_date - (K0-1) days`. When no week 1 exists at all, `K0` falls back to `1` and
`trueMonday` is just `instantiation_start_date` (pre-HRA-124 behavior). If `instantiation_start_date`'s
weekday doesn't land `trueMonday` on an actual Monday, the New Instance form shows a non-blocking
warning (never a save-blocking one — a separate class from the DSL zero-warning gate above).
**Per-day date (HRA-122):** each day's concrete `date` is `week.start_date + (day.day - 1)` days
(`D1` = the week's start date, `D7` = 6 days later) — before HRA-122 every day in a week was
persisted with the identical `week.start_date`, a bug.

**Regenerate deletes by day identity, not date (HRA-155):** `POST /api/v1/plan-instances/:id/regenerate`
(below) replaces the cutover-and-later slice of an instance's days by deleting each regenerated
day's previous row keyed on `(instance_id, section_name, week_number, day)`
(`plan-instances.repo.ts`'s `deleteDayByIdentity`) — **not** a raw `date >= effective_from`
threshold (the original HRA-132 implementation). A date-threshold delete silently breaks the moment
`start_date` changes as part of the same regenerate call: the OLD rows' dates and the FRESHLY
regenerated rows' dates are then computed from two different baselines, so one date threshold can't
reliably tell which old row a fresh one supersedes — it produced orphaned stale rows and/or
duplicate rows for the same day. `garmin-stats/src/jobs/cleanup-plan-instance-day-dates.ts`
(`npm run cleanup:plan-instance-dates`) is the one-time script that repaired the rows already
corrupted by this bug (and by the pre-HRA-122 bug above) at the time it was fixed — safe to rerun
(it's idempotent: recomputes each day's correct date from the template + instance's own `start_date`
and only touches rows that actually disagree), but not part of any regular sync/migration path.

**Regenerate preflight/confirm gate (HRA-299):** before the delete+recreate above runs, the
controller queries every currently-persisted day in `[effective_from, end]` that carries a
`customized_at` marker (`plan-instances.repo.ts`'s `customizedDaysFrom`) — if any exist and the
request's `confirm_overwrite` isn't `true`, it 409s (naming every affected day's id/date/section/
week/day/workout_type/notes on the problem body's `customized_days` field) instead of proceeding.
The "explicit warn-before-overwrite" contract this Story requires as a hard floor: a customized day
outside the requested range is never touched and never blocks anything (same "protects
already-logged history" reasoning `deleteDayByIdentity` above already established for dates), and a
confirmed regenerate clears every marker it overwrites for free — every regenerated row is a fresh
insert, which always starts `customized_at NULL` regardless of what it replaces.

**Auto-filled rest days (HRA-124):** any
D-number 1-7 a week doesn't declare is generated as an extra `workout_type: "rest"` row for that
week, dated the same way, with `notes` set to the instantiate request's `rest_day_label` (if any) and
a single synthetic `rest_block` segment carrying `rest_type` from the template's `DEFAULT_REST`
metadata (`jog` if unset) — reuses the existing `ResolvedSegment` shape rather than adding a new
column. Implemented in `domain/runplan/instantiate.ts`'s `instantiatePlan()`.

### `workout_associations`
Persisted link between one actual `activities` row and one planned workout — HRA-334, "Associate
planned workouts with actual activities conservatively". Columns: `id`, `activity_id` (`UNIQUE`,
`ON DELETE CASCADE` — an activity's own evidence belongs to at most one planned workout at a time),
`workout_id` (nullable TEXT — `plan_instance_days.workout_id`, HRA-333's stable identity, **not**
`plan_instance_days.id`, so the link survives a day/week swap or a regenerate), `status`
(`'automatic' | 'manual_confirmed' | 'manual_changed' | 'unresolved'`), `created_at`, `updated_at`.
`workout_id` is deliberately **not** unique — many activities (e.g. a run split across two device
files) can share one planned workout once a human manually links both (AC1's "zero, one, or multiple
actual activities per planned workout where manually permitted").

**Provenance (AC8):** `'automatic'` — this Story's own uniqueness-only matcher (below) set it, never
touched by a human. `'manual_confirmed'` — a human accepted the current `workout_id`, whether it
started `'automatic'` or was freshly picked. `'manual_changed'` — a human pointed this activity at a
different `workout_id`, **including `workout_id = NULL`** to explicitly record "not part of any
plan" (`DELETE /api/v1/activities/:id/association` — see below; recorded as a row, not a deleted one,
so a later import can never silently re-attach it). `'unresolved'` — a previously-`'automatic'` row
whose uniqueness broke on a later import (AC10). Only `'manual_confirmed'`/`'manual_changed'` are
immune to reconciliation (AC9); every other status is re-evaluated on every sync.

**Automatic matching (`domain/workout-association.ts`'s `reconcileAssociations`, pure, no I/O):**
conservative and symmetric — a "run"-type `plan_instance_days` row and a `sport = 'running'` activity
pair up automatically **only** when each is the OTHER's sole remaining compatible candidate on the
SAME local calendar date (AC2/AC4). "Local date" is computed via `domain/plan-timezone.ts`'s
`localDateInTimeZone(activity_date, schedule_timezone)` — the OWNING plan instance's own persisted
`schedule_timezone` (HRA-332), never `activities.date_only` and never a shared/global timezone (AC3;
this is also what makes travel/DST correctness fall out for free — each candidate workout's own
instance timezone is used independently). No distance/duration/pace/title/similarity scoring is ever
introduced (Story's own out-of-scope list) — uniqueness is the only signal. REST/`OTHER`/`todo`/
`cross`/`strength` plan days are never even passed into the matcher — only `workout_type = 'run'` days
are candidates at all (AC5/AC6), so an activity landing on a REST day is simply never treated as
matching one. A human-locked row (`'manual_confirmed'`/`'manual_changed'`) removes BOTH the workout
and the activity from the matching pool entirely (AC9) — never reassigned, never demoted. Re-run on
every activity sync (`sync-garmin.ts`/`sync-strava.ts`, each opens its own DB connection as a separate
process — see `services/workout-associations.service.ts`'s `reconcile()`): a currently-`'automatic'`
row whose uniqueness broke (a later import introduced a competing candidate, or its workout left
Current entirely) is demoted to `'unresolved'` rather than deleted or silently left accepted (AC10) —
kept, not deleted, so the case stays inspectable instead of looking "never evaluated." An
`'unresolved'` row is likewise re-evaluated every run and can resolve back to `'automatic'` if the
ambiguity clears (e.g. the competing activity is later removed).

**Manual endpoints** (`controllers/activities.controller.ts`): `GET /api/v1/activities/:id/association`
returns the current link (an `AssociationView` with `workout_id`/`status` all `null` when none exists
yet — a legitimate "extra/unplanned" steady state, not a 404). `GET
/api/v1/activities/:id/association-candidates` returns every "run" day (any instance) sharing this
activity's own local date (AC3), for a manual replace/confirm picker. `PUT
/api/v1/activities/:id/association` (body `{workout_id}`) sets/replaces/confirms the link — 422 if
`workout_id` doesn't name a current plan day; `'manual_confirmed'` if `workout_id` is unchanged from
what's already on record, `'manual_changed'` otherwise (including a first-ever manual pick — AC8).
`DELETE /api/v1/activities/:id/association` explicitly marks the activity as not part of any plan
(`workout_id = NULL`, `'manual_changed'` — Scope: "represent extra/unplanned activities truthfully").

**Workout-day status (AC11/AC12, `domain/workout-association.ts`'s `computeWorkoutDayStatus`, pure):**
a future/current local plan day is always `pending` regardless of evidence; a past one is `completed`
only when an accepted association exists for its `workout_id` (`'automatic'`/`'manual_confirmed'`/
`'manual_changed'` all count — `'unresolved'` does not, since it is explicitly not-yet-resolved) and
otherwise `missed`. `completed` never implies targets were achieved — only that accepted evidence
exists. Not yet wired into any Agenda/Calendar UI surface (out of scope for this Story's slice — see
its own "Relevant existing areas," none of which name those screens); the pure predicate exists and is
tested, ready for a future Story to surface it.

### `feedback`
Anonymous visitor feedback (HRA-226) — one row per `POST /api/v1/feedback` submission, no
visitor/session identity captured (no dedup, no rate limiting). Columns: `id`, `free_text`,
`pricing_choice` (one of `free_only | 3_5 | 8_12 | 15_plus`), `pricing_why_not_free_text` (only
meaningful when `pricing_choice === 'free_only'`), `feature_interest` (TEXT, JSON-serialized
`string[]` of `multi_user_coach | shared_groups`), `feature_interest_other_free_text`,
`created_at`. Every column is nullable — the "at least one field non-empty" rule is enforced
app-side (`feedback.controller.ts`), not as a DB constraint. No GET/list route exists (out of
scope for HRA-226); no soft delete either — this table has no trash lifecycle.

## Soft delete & trash
`activities` and `body_measurements` both have `deleted_at` (TEXT, nullable) and `purged` (INTEGER, default 0). Three states per row:
- **Active** — `deleted_at IS NULL`. Shows up everywhere normally; every read query in `server.ts` (`activities`, `activityById`, `summary`, `weekly`, `monthly`, `range`, `countInRange`, and the `body_*`/`correlation` equivalents) filters `deleted_at IS NULL`.
- **Trashed** — `deleted_at` set, `purged = 0`. What used to be a hard `DELETE` (`DELETE /api/activity/:id`, `DELETE /api/activities?from&to`, `DELETE /api/body?from&to`) now just sets `deleted_at`, an `UPDATE`. Fully intact, listed by `GET /api/activities/trash` / `GET /api/body/trash`, restorable via `POST /api/activities/restore` / `POST /api/body/restore` (`{ids: number[]}`, clears `deleted_at`).
- **Purged** — `purged = 1` (`deleted_at` stays set). "Empty the trash" (`POST /api/activities/purge` / `POST /api/body/purge`, same `{ids}` shape) — permanent, not restorable, and no longer listed by the trash endpoints. To actually reclaim space this wipes `track_points` (`DELETE FROM track_points WHERE activity_id = ?`) and every heavy/summary column (`distance_m`, `avg_hr`, `weight_kg`, etc. → `NULL`), but **deliberately keeps `filename` (activities) / `measured_at` (body_measurements)** — that's the load-bearing part: `sync-garmin.ts`'s dedup check (`SELECT filename FROM activities`, no `WHERE`) and `sync-withings.ts`'s `INSERT OR IGNORE` (keyed on `measured_at`'s `UNIQUE` constraint) both read/write unconditionally, so a purged row's surviving key is what stops a resync from silently reimporting something the user deliberately deleted. `sync-strava.ts`'s cross-source dedup check is the same story — it doesn't filter `deleted_at` either, so a trashed or purged activity still counts as "existing" and blocks a duplicate Strava import. **None of the three sync scripts needed any code changes** for this — the existing "read everything, ignore soft-delete state" queries already did the right thing by construction once `deleted_at`/`purged` existed.
- UI: `ManageTab.tsx`'s `TrashSection` (Data & Sync tab) lists both entity types with checkboxes, Restore / Delete-permanently (with a confirm step, same pattern as the Delete card above it).
