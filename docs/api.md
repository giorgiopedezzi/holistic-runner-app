# API endpoints (server.ts — port 3001)

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

**Machine-readable contract:** `garmin-stats/openapi.json` (served live at `GET /api/v1/openapi.json`,
rendered at `GET /api/v1/docs`) is the source of truth for exact request/response schemas and status
codes — this file is the human-readable index. The two must stay in sync (CLAUDE.md's routing-table
rule); this table exists for quick lookup, not as a second contract.


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
| `/api/v1/activity-types` | The fixed `activity_types` lookup (Training, Race 5km, Race 10km, Half-Marathon, Marathon), each with `min_distance_m` |
| `/api/v1/activities/races` | Race-type activities (`activity_type_id != 1`), full history, `{id,date_only,activity_type_id,activity_name,distance_m}` — feeds the "link a race" dropdown on the date-ranges save form |
| `/api/v1/date-ranges` | Saved named date ranges (paginated envelope), newest first — each row `LEFT JOIN`s its linked race activity's display fields (`race_date_only`/`race_activity_name`/`race_distance_m`/`race_activity_type_id`, all `NULL` if unlinked). See `docs/schema.md`'s `date_ranges` section |
| `/api/v1/locales/:lang` | Translation bundle for `:lang` (`en` or `it`) — flat key→string JSON, read live off `garmin-stats/locales/<lang>.json`, no envelope. `:lang` is whitelisted before touching the filesystem; `problem+json` 404 for an unsupported or missing language |
| `/api/v1/plan-templates` | Saved training-plan templates (paginated envelope), newest first. See `docs/schema.md`'s `plan_templates` section (HRA-112) |
| `/api/v1/plan-templates/:id` | Single plan template (includes `approved_at`, HRA-113) |
| `/api/v1/plan-instances?template_id=` | Resolved plan instances (paginated envelope), newest first (HRA-118) — added since the instance card needs a way to list more than one at a time; no prior endpoint returned a collection. `template_id` is optional (a "list all" vs. a per-template list); 404 if a given `template_id` doesn't reference a real template, 400 if it isn't an integer |
| `/api/v1/plan-instances/:id` | A resolved instance of a template — the instantiate response's own `Location` target — plus its `days` (all `plan_instance_days` rows, each with `segments` as JSON), `approved_at` (HRA-113), `name`/`event` (HRA-114), and `race_name`/`race_date`/`race_url` (HRA-121, all nullable) |

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
| `/api/v1/settings/date-format` | Body `{date_format}`, must be one of `'numeric_uk' | 'numeric_us' | 'literal_uk' | 'literal_us'` (422 otherwise). Same immediate-apply pattern as theme/units/detail-view |
| `/api/v1/settings/language` | Body `{language}`, must be one of `'auto' | 'en' | 'it'` (422 otherwise). `'auto'` resolves from the browser's `navigator.language` at render time (garmin-dashboard's `i18n.ts`), same idiom as `unit_system`'s `'auto'`. Same immediate-apply pattern as theme/units/detail-view/date-format |
| `/api/v1/settings/palette` | Body `{palette}`, must be one of `'metal' | 'warm'` (422 otherwise). Dashboard palette flavor, crossed with `theme` for 4 total looks — applied via a `data-palette` attribute (garmin-dashboard's `index.css`), compounded with the existing `data-theme` attribute. Also writes the paired `accent_color` server-side (`metal`→`sky`, `warm`→`amber`) — see `settings.controller.ts`. `'metal'` is the default. Same immediate-apply pattern as theme/units/detail-view/date-format/language. Replaces the earlier `/style-pack` endpoint (HRA-119) entirely |
| `/api/v1/activities/:id/type` | Body `{activity_type_id, name?}` — full replacement of the activity's type/name sub-resource. 422 if the type is unknown or the activity's `distance_m` is shorter than the type's `min_distance_m`; 404 if the activity doesn't exist |
| `/api/v1/date-ranges/:id` | Body `{name, from, to, activity_id?}` — full replacement, incl. renaming (the Data & Sync tab's "Update" row). Same validation as `POST /api/v1/date-ranges` below, except the duplicate-name check excludes the row's own id (so re-saving under its current name doesn't 409 itself). 404 if the row doesn't exist |
| `/api/v1/plan-templates/:id` | Body `{name, event, distance_m?, dsl_source}` (HRA-120) — full replacement; `dsl_source` is re-parsed from scratch, `event`/`distance_m` validated the same as `POST /api/v1/plan-templates` below. 404 if the template doesn't exist. Always clears `approved_at` back to `NULL` (HRA-113 gate 2 — any edit revokes approval, even one that still parses with zero warnings) |
| `/api/v1/plan-instances/:id` | Body `{name, days: [...]}` — full replacement of the instance's name + resolved days. `name` required (422 if missing/blank, HRA-114); `event` is never accepted here — read-only/derived from the template. **Each day is `{section_name, week_number, date, dsl}` (HRA-115)** — `dsl` is the raw D-line text, same grammar as a template (e.g. `"D3 [interval]: 4x3000m @ RG-20 r:1km @ RG+10"`), not pre-resolved segments. The backend looks up that day's section/week in the source template's parsed plan for its effective `PacePolicy`, merges in the instance's own `pace_overrides`, re-parses the `dsl` against that policy, and resolves it the same way instantiation resolves a segment. Rejects with 422 (listing which days) if any day's fresh parse still needs review. Never touches or re-instantiates the source template. Clears `approved_at` back to `NULL`, same gate-2 rule as the template PUT above. 404 if the instance doesn't exist (HRA-113) |

### POST
| Endpoint | Description |
|---|---|
| `/api/sync/garmin` | Spawns `sync-garmin.ts`, streams NDJSON progress events (`{type:"progress",phase,current,total,label}`), ends with `{type:"done",imported,skipped,errors}` or `{type:"error",message}` |
| `/api/sync/withings?from=&to=` | Spawns `sync-withings.ts` via `child_process.spawn` (passing `from`/`to` through as `--from`/`--to` CLI args if given), returns `{ imported, skipped, errors }` (blocking, single response). If `from`/`to` are omitted, the script falls back to its own default (since last synced measurement, or 2 years back on first run) |
| `/api/sync/strava?from=&to=` | Same pattern as Withings' sync route, spawns `sync-strava.ts`. `skipped` in the response folds in cross-source duplicates (see "Strava sync" below) |
| `/api/settings/background/upload?ext=jpg\|jpeg\|png\|webp\|gif` | Body is the **raw image bytes** (`Content-Type` set to the image's own mime type) — deliberately not `multipart/form-data`, since this app has zero runtime dependencies and a raw-body upload needs no parser at all (frontend just does `fetch(url, {method:"POST", body: file})`). Max 10MB. Writes to `garmin-stats/backgrounds/bg-<timestamp>.<ext>`, best-effort deletes the previous custom file (failure swallowed, not fatal), sets `background_kind='custom'` |
| `/api/activities/restore`, `/api/activities/purge` | Body `{ids: number[]}` (400 if empty/non-integers). Restore clears `deleted_at`; purge wipes the row's heavy data and sets `purged=1` — see "Soft delete & trash". Looped single-row prepared statements inside one transaction, not a dynamic `IN (...)` clause, so every bound value stays a real parameter |
| `/api/body/restore`, `/api/body/purge` | Same shape/semantics as the activities pair, for `body_measurements` |
| `/api/v1/date-ranges` | Body `{name, from, to, activity_id?}`. `name` must be unique (409 otherwise); `from`/`to` are `YYYY-MM-DD` with `from <= to`; `activity_id`, if given, must be a race-type activity (`activity_type_id != 1`) whose `date_only` is strictly after `to` (422 otherwise). Returns 201 + `Location` + the created row (with the joined race fields) |
| `/api/v1/plan-templates/generate` | Body `{dsl_source}`. Runs the same parse as `POST /api/v1/plan-templates` but **never persists** — returns `{plan, warnings}` (per-day warnings live on each `DayEntry`, `warnings` here is the plan-scoped ones only). 422 (with an `errors` list) only if the DSL fails to parse outright (`ParseResult.ok:false`); a plan with day-level warnings still returns 200. What a review UI calls on every edit before the user is ready to save (HRA-113) |
| `/api/v1/plan-templates` | Body `{name, event, distance_m?, dsl_source}` (HRA-120). `event` required, one of `5k \| 10k \| half \| marathon \| custom`; `distance_m` required iff `event === "custom"`, rejected (422) if supplied for any other event. `dsl_source` is parsed via `domain/runplan/parser.ts`; 422 (with a per-day `errors` list) unless the DSL parses **and** has zero outstanding warnings anywhere in the tree (HRA-113 — nothing the parser encounters is a hard error anymore, only warnings; replaces HRA-111's `valid`/`errors` model). The controller sets `parsed_plan.metadata.event`/`.distance_m` from `event`/`distance_m` after parsing, unconditionally overwriting anything the DSL's (now-vestigial) `EVENT`/`DISTANCE` lines produced. Returns 201 + `Location` + the created row |
| `/api/v1/plan-templates/:id/instantiate` | Body `{name, start_date, pace_overrides?, goal_time?, race_pace_anchor?, distance_m?, target_activity_id?, race_name?, race_date?, race_url?}`. `name` required (422 if missing/blank, HRA-114) — the instance's own name; the created instance's `event` is never a request parameter, always auto-populated as a denormalized copy of the template's `event`. `start_date` required (`YYYY-MM-DD`); `pace_overrides` is `{anchor: "pace string"}` using the same grammar as a `PACE` line's right-hand side (e.g. `{"RG": "6:40/mi"}`), 422 on an unparseable value; `goal_time` (`HH:MM:SS`, HRA-113) is an alternate way to supply a pace anchor — **`race_pace_anchor` names which one, and is required whenever `goal_time` is supplied (HRA-121 — no default; earlier versions hardcoded `RG`)** — converted via distance (`distance_m` if given, else the template's own `distance_m`, else the event's standard distance; `custom` has no standard distance, but its `distance_m` is mandatory at template save time, HRA-120, so this call's own `distance_m` is only needed to *override* a custom template's distance, not to supply one that's missing); supplying both `goal_time` and an explicit `pace_overrides` value for the same `race_pace_anchor` is rejected as ambiguous; `target_activity_id`, if given, validated like `date_ranges.activity_id` but against the *resolved plan's last day* (422 otherwise, checked **before** any write, so a rejected instantiate leaves no orphaned rows) — **kept as a backend capability but no longer surfaced by the New Instance form's UI (HRA-121), which replaced it with the free-text `race_url` below**; `race_name`/`race_date`/`race_url` (HRA-121, all optional, `race_date` must be `YYYY-MM-DD` if given, `race_url` unvalidated free text) are a description of the race this instance targets, independent of `target_activity_id` — a race that hasn't happened yet may have no linkable activity row at all. Returns 201 + `Location` (`/api/v1/plan-instances/:id`) + the created instance with its resolved `days` |
| `/api/v1/plan-templates/:id/approve` | No body. Sets `approved_at` (gate 2, HRA-113) — only meaningful on a saved (already zero-warning) template. Returns the updated row |
| `/api/v1/plan-instances/:id/approve` | No body. Same gate-2 semantics as the template approve endpoint above, for an instance (HRA-113) |

### DELETE (date ranges / plan templates / plan instances — hard delete, not soft)
| Endpoint | Description |
|---|---|
| `/api/v1/date-ranges/:id` | Deletes a saved date range permanently (204). Unlike activities/body measurements, saved ranges have no trash — they're just a recall label, not synced data |
| `/api/v1/plan-templates/:id` | Deletes a plan template permanently (204) — `ON DELETE CASCADE` also removes every instance (and each instance's days) derived from it. No trash, same reasoning as date ranges |
| `/api/v1/plan-instances/:id` | Deletes a plan instance permanently (204, HRA-115) — `ON DELETE CASCADE` also removes its `plan_instance_days` rows. No trash, same reasoning as plan templates. 404 if the instance doesn't exist |
