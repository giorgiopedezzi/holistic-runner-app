# SQLite / Tenancy Read-Only Audit

## 1. Audit metadata

- Repository: `C:\Projects\PERSONAL\holistic-runner-app`
- Branch: `bugfix/codex-env-policies`
- HEAD: `582c5033f6777aa09312d51ad4bc30ee49467255`
- Working tree: clean; no pre-existing uncommitted files reported.
- Schema source(s): database-verified local `garmin-stats/garmin.db`; current initializer `garmin-stats/src/db.ts`; repository/docs cross-check.
- Local DB inspected: `garmin-stats/garmin.db`
- Database inspection mode: Node 24 `node:sqlite` `DatabaseSync(..., { readOnly: true })`; metadata and `COUNT(*)` only. No application startup or schema initialization.
- Limitations:
  - No Railway database/volume was accessed.
  - The checked-in local DB contains two empty legacy tables not created or referenced by current code: `training_plans`, `planned_workouts`.
  - Row values, tokens, FIT payloads, location data, and health values were not inspected.

## 2. Current persistence architecture

`garmin-stats/src/db.ts` loads mandatory `DB_PATH` from environment (or `--db`), resolving non-`:memory:` paths relative to the process working directory. No repository default production path is hard-coded.

The live application opens SQLite through Node’s built-in `node:sqlite` `DatabaseSync`, then executes:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`

`initSchema()` uses `CREATE TABLE IF NOT EXISTS`, seeds singleton/reference rows with `INSERT OR IGNORE`, and contains guarded runtime migration/repair code based on `PRAGMA table_info`, including many `ALTER TABLE ADD COLUMN`, one `DROP COLUMN style_pack`, and data backfills. There is no separate migration ledger/table or schema-version mechanism.

The normal server, Garmin/Strava/Withings sync jobs, maintenance jobs, and the Withings login job all call `initSchema()`. Thus startup/job execution can mutate schema/data.

Persistence is accessed through repositories, services, controllers, and jobs. Raw archives and uploaded backgrounds are durable filesystem state outside SQLite. Demo mode can periodically overwrite a live DB from `DEMO_DB_BACKUP_PATH` and append feedback text beside the DB.

## 3. Complete SQLite object inventory

### Tables

| Table | Rows | PK | FKs | Important uniqueness/indexes | Main writers | Main readers |
|---|---:|---|---|---|---|---|
| activities | 222 | `id` | none declared for `activity_type_id` | `filename` unique; `idx_activities_date(date_only)` | Garmin/Strava sync; activity controller/services; classifier | activities repo/controllers, reporting, plan links |
| activity_types | 5 | `id` | — | `name` unique | `initSchema` seed only | activity-type/activity controllers |
| body_measurements | 34 | `id` | — | `measured_at` unique; `idx_body_date(date_only)` | Withings sync; body lifecycle | body repo/controllers/reporting |
| date_ranges | 2 | `id` | `activity_id → activities.id` | `name` unique | date-ranges controller/repo | date-ranges controller/repo |
| feedback | 0 | `id` | — | — | feedback endpoint | returned after insert only; demo export |
| plan_templates | 2 | `id` | — | — | plan-template controller/repo | templates, instance creation |
| plan_instances | 2 | `id` | `template_id → plan_templates` CASCADE; `target_activity_id → activities` | `idx_plan_instances_template` | plan-instance service/repo | plan/reporting/association features |
| plan_instance_days | 56 | `id` | `instance_id → plan_instances` CASCADE | indexes on `instance_id`, `date`; no DB unique slot/workout key | instantiate/regenerate/day editing | agenda, reporting, associations |
| workout_associations | 0 | `id` | `activity_id → activities` CASCADE | `activity_id` unique; `idx_workout_associations_workout(workout_id)` | reconciliation/manual association operations | association/reporting features |
| workout_segment_alignments | 0 | `id` | `activity_id → activities` CASCADE | unique `(workout_id, segment_index)`; workout index | manual quality-alignment feature | workout reporting |
| settings | 1 | `id`, `CHECK(id=1)` | — | singleton by check | settings controller; initializer seed | settings, frontend configuration, plan creation |
| strava_tokens | 1 | `id`, `CHECK(id=1)` | — | singleton by check | Strava OAuth exchange/refresh | Strava status/sync |
| withings_tokens | 1 | `id`, `CHECK(id=1)` | — | singleton by check | Withings OAuth exchange/refresh | Withings status/sync |
| track_points | 696,318 | `id` | `activity_id → activities` CASCADE | `idx_track_activity(activity_id)` | Garmin/Strava sync; FIT reprocess | activity detail/reporting |
| training_plans | 0 | `id` | `target_activity_id → activities` | `idx_training_plans_dates(start_date,end_date)` | UNKNOWN — no current code reference | UNKNOWN — no current code reference |
| planned_workouts | 0 | `id` | `plan_id → training_plans` CASCADE | indexes on `plan_id`, `date` | UNKNOWN — no current code reference | UNKNOWN — no current code reference |

Views: none.

Triggers: none.

Indexes not otherwise covered:

- SQLite autoindexes implement the unique constraints listed above.
- No expression, partial, collation-specific, or trigger-backed indexes were found.

## 4. Classification matrix

| Table | Primary classification | Current purpose | Current ownership | Ownership root | Confidence | Evidence |
|---|---|---|---|---|---|---|
| activities | USER-OWNED | Imported/private activity and classification data | DIRECT; no owner concept today | activity | High | sync jobs, activity APIs, reporting |
| activity_types | SYSTEM/COMMON | Fixed activity-type reference vocabulary | NONE TODAY | n/a | High | fixed initializer seed; read-only API |
| body_measurements | USER-OWNED | Withings body/health measurements | DIRECT; no owner concept today | body measurement | High | Withings sync, body APIs |
| date_ranges | USER-OWNED | Saved personal comparison/training ranges | DIRECT; optional activity link | date range | High | controller/repo behavior |
| feedback | SYSTEM/COMMON | Anonymous product feedback submissions | NONE TODAY | n/a | Medium | anonymous public endpoint; no visitor identity |
| plan_templates | USER-OWNED | Reusable authored RunPlan DSL templates | DIRECT; no owner concept today | template | High | author/edit/approve endpoints |
| plan_instances | USER-OWNED | Race-specific plan instantiation and revisions | DIRECT | plan instance | High | template FK, instance APIs |
| plan_instance_days | USER-OWNED | Resolved/customized workouts of an instance | INHERITED | plan instance | High | mandatory cascading instance FK |
| workout_associations | USER-OWNED | Actual-activity to planned-workout link/provenance | MIXED: activity FK plus un-enforced textual workout ID | activity / plan instance | High | association repo/service |
| workout_segment_alignments | USER-OWNED | Manual actual-segment alignment for planned workouts | MIXED: activity FK plus textual workout ID | activity / plan instance | High | alignment repo/reporting |
| settings | USER-OWNED | Runner preferences and singleton app settings | DIRECT; singleton `id=1` | settings profile | High | settings API and plan timezone fallback |
| strava_tokens | INTEGRATION | Strava OAuth credential singleton | DIRECT; singleton global account | provider connection | High | OAuth/sync modules |
| withings_tokens | INTEGRATION | Withings OAuth credential singleton | DIRECT; singleton global account | provider connection | High | OAuth/sync modules |
| track_points | USER-OWNED | Activity telemetry including location | INHERITED | activity | High | mandatory CASCADE FK |
| training_plans | USER-OWNED | Legacy personal plan root | DIRECT, inferred from legacy schema only | legacy training plan | Medium | actual DB only; no code references |
| planned_workouts | USER-OWNED | Legacy planned-workout children | INHERITED | legacy training plan | Medium | actual DB only; CASCADE FK |

No existing tables qualify as AUTH/IDENTITY, SESSION, PUBLICATION, or AUDIT.

## 5. Detailed table analysis

### activities

Purpose: Canonical imported Garmin/Strava activity summaries plus classification, soft-delete, purge, race typing, and source provenance.

Classification: USER-OWNED. Confidence: High.

Columns relevant to identity/ownership: `id`, globally unique `filename`, `source`, `activity_date`, `deleted_at`, `purged`, `activity_type_id`, `activity_name`.

Parent relationships: no declared FK for `activity_type_id`; the application validates it.

Child relationships: `track_points`, `workout_associations`, `workout_segment_alignments`; optional references from ranges and plan instances.

Written by: Garmin/Strava sync, reprocess job, activity type/classification/feedback/lifecycle operations.

Read by: activities repository, dashboard APIs, reporting, associations, date ranges, plan instances.

Current single-user assumptions: all activity queries filter dates/deletion state, never a principal. `filename` is global and doubles as Garmin filename/Strava synthetic filename deduplication.

Current uniqueness assumptions: `filename UNIQUE`; this blocks re-import even for trashed/purged rows.

Sensitive fields: classification feedback; activity/fitness metadata.

File/cache/job dependencies: FIT archive and Strava JSON archive map to imported activities.

Ownership assessment:

- DIRECT
- Likely ownership root: activity
- Evidence: it is the imported personal aggregate root; all child telemetry has an activity FK.

Multi-user risk if unchanged: critical cross-user data disclosure and global external-import collision.

Open questions: whether source identifiers should remain filename-derived or receive provider-account-aware identity is a product/architecture decision.

### activity_types

Purpose: Fixed Training/Race reference values and distance thresholds.

Classification: SYSTEM/COMMON. Confidence: High.

Identity: explicit seeded IDs 1–5; `name UNIQUE`.

Written by: `initSchema()` only. Read by activity typing endpoints.

Single-user assumption: none material.

Ownership: NONE TODAY; common lookup data.

Risk: low, except activity type enforcement is application-side rather than a declared FK.

### body_measurements

Purpose: Withings health/body measurement history with trash/purge lifecycle.

Classification: USER-OWNED. Confidence: High.

Identity: `id`, globally unique `measured_at`; `date_only`; `deleted_at`, `purged`.

Parents/children: none.

Written by: `sync-withings`, body lifecycle services.

Read by: body APIs/correlation/reporting.

Current single-user assumptions: all range/correlation queries lack user filtering.

Uniqueness: `measured_at UNIQUE` globally.

Sensitive fields: all health measurements; values were not inspected.

Ownership: DIRECT; root is a body measurement.

Risk: critical health-data disclosure and global provider timestamp collisions.

### date_ranges

Purpose: Runner-saved named date windows, optionally linked to a race activity.

Classification: USER-OWNED. Confidence: High.

Identity: `id`, `name UNIQUE`, optional `activity_id`.

Parent: optional activity FK, no cascade.

Written/read by: date-ranges controller/repository; rendered in dashboard range features.

Single-user assumptions: global name uniqueness and no owner predicate.

Ownership: DIRECT; root is date range.

Risk: users can see and overwrite/conflict on each other’s saved names.

### feedback

Purpose: Anonymous visitor feedback from `POST /api/v1/feedback`.

Classification: SYSTEM/COMMON. Confidence: Medium.

Secondary concern: anonymous guest-originated product data.

Ambiguity: it is not a canonical lookup, but it also has no runner or visitor identity and does not govern publication.

Written by: feedback controller/repository.

Read by: post-insert response; demo restore exports all rows to a text file.

Sensitive fields: free-text fields may contain personal information; values not inspected.

Ownership: NONE TODAY.

Risk: a future feedback administration surface would need an explicit access policy; demo export is unscoped.

### plan_templates

Purpose: Reusable DSL source and parsed unresolved plan, with approval state.

Classification: USER-OWNED. Confidence: High.

Identity: `id`; no name uniqueness; `dsl_source`, `parsed_plan`, `event`, `approved_at`.

Children: `plan_instances` cascade on deletion.

Written/read by: plan-template repository/controller and plan-instance creation.

Current single-user assumptions: all templates are globally listed/editable; no persistence distinction exists between system templates and user templates.

Ownership: DIRECT; root is a template.

Risk: users could modify/delete/read other users’ templates and their instances.

### plan_instances

Purpose: Concrete race-specific instantiation of a template, including pace overrides, race metadata, schedule timezone, original/current snapshots, and revision counters.

Classification: USER-OWNED. Confidence: High.

Identity: `id`, `template_id`, optional `target_activity_id`; no tenant column.

Parents: template FK cascade; optional activity FK no action.

Children: `plan_instance_days` cascade.

Written/read by: plan-instance service/repo/controller, reporting, association reconciliation.

Current single-user assumptions: global list/active-date matching/approved-plan overlap checks; no user predicate.

Ownership: DIRECT; root is plan instance.

Risk: very high; a “global active plan” is derived by date over all instances, and plan/report associations cross the entire data set.

### plan_instance_days

Purpose: Resolved plan-day/workout rows, including JSON segments, scheduled time, customization marker, and stable `workout_id`.

Classification: USER-OWNED. Confidence: High.

Identity: `id`; `workout_id` is nullable in schema, supplied by application on new inserts; no unique constraint.

Parent: required `instance_id` FK with `ON DELETE CASCADE`.

Children: logical references from association/alignment tables use `workout_id`, but there is no FK.

Written/read by: instantiation, regeneration, bulk/single-day editing; agenda, reporting, association services.

Single-user assumptions: date and workout candidate queries scan all plan instances.

Ownership: INHERITED through required plan instance.

Risk: high; text `workout_id` is not DB-scoped, and matching/reporting queries have no owner boundary.

### workout_associations

Purpose: Actual activity ↔ planned workout association and provenance status.

Classification: USER-OWNED. Confidence: High.

Identity: `id`; `activity_id UNIQUE`; nullable textual `workout_id`.

Parent: activity FK cascade. Logical parent: plan day via `workout_id`, no FK.

Written by: automatic reconciliation and manual association endpoints.

Read by: association and reporting services.

Ownership: MIXED. It inherits from activity physically, but also references a plan instance indirectly through an unenforced global workout ID.

Risk: high; cross-user matching is possible if IDs or candidates are visible globally.

### workout_segment_alignments

Purpose: Manual alignment/correction of an actual activity to a work segment in a planned workout.

Classification: USER-OWNED. Confidence: High.

Identity: `id`, unique `(workout_id, segment_index)`.

Parent: activity FK cascade; logical parent plan day via `workout_id`, no FK.

Written/read by: alignment repository and workout reporting.

Ownership: MIXED.

Risk: high; global unique `(workout_id, segment_index)` and no plan/user FK permit cross-user collisions or invalid cross-owner relationships.

### settings

Purpose: Global singleton UI, unit, timezone, background, and analytics preferences.

Classification: USER-OWNED. Confidence: High.

Identity: singleton `id=1 CHECK(id=1)`.

Written/read by: settings controller/repository; consumed throughout frontend and when creating plan-instance schedule timezones.

File dependency: `background_value` can name a file under `garmin-stats/backgrounds/`.

Ownership: DIRECT; root is runner settings profile.

Risk: critical: one user changes appearance/timezone/preferences for all users; background filename is global.

### strava_tokens / withings_tokens

Purpose: Singleton provider OAuth credentials and expiry/scope state.

Classification: INTEGRATION. Confidence: High.

Identity: `id=1 CHECK(id=1)`.

Sensitive fields:

- `access_token` [SENSITIVE — value not inspected]
- `refresh_token` [SENSITIVE — value not inspected]
- `expires_at`
- `scope`

Written by: provider OAuth exchange and token refresh.

Read by: integration status and sync jobs.

Ownership: DIRECT; likely root is a per-user provider connection.

Risk: critical: one global external account is assumed; refreshes overwrite the singleton credential row.

### track_points

Purpose: Per-activity telemetry: time, distance, heart rate, pace/speed, cadence, altitude, power, latitude/longitude, stamina.

Classification: USER-OWNED. Confidence: High.

Parent: required `activity_id` FK with `ON DELETE CASCADE`.

Written by: Garmin and Strava sync, FIT reprocess.

Read by: activity details and reporting.

Sensitive fields: location (`lat`, `lon`) and health/performance data; values not inspected.

Ownership: INHERITED through activity.

Risk: critical precise-location leakage if activity access is not principal-scoped.

### training_plans

Purpose: Empty legacy personal-plan root retained in local DB only.

Classification: USER-OWNED. Confidence: Medium.

Evidence: actual DB schema has plan fields and optional target activity, but no current source-code matches and current initializer does not create it.

Ownership: DIRECT, inferred from legacy semantics.

Risk: currently dormant but must be accounted for in an actual-database migration inventory.

### planned_workouts

Purpose: Empty legacy workout child retained in local DB only.

Classification: USER-OWNED. Confidence: Medium.

Evidence: required `plan_id → training_plans(id) ON DELETE CASCADE`; no current source-code matches; absent from current initializer.

Ownership: INHERITED through legacy `training_plans`.

Risk: dormant but part of the local schema; migration treatment cannot be inferred from current code.

## 6. Non-table durable state

| Artifact | Location | Purpose | Current ownership assumption | Sensitive? | Tenancy concern |
|---|---|---|---|---|---|
| SQLite database | `garmin-stats/garmin.db` / runtime `DB_PATH` | all database persistence | one global database | yes | entire data set is globally addressed |
| WAL/SHM sidecars | adjacent to runtime DB when active | SQLite WAL state | global | potentially | demo restore explicitly handles sidecars |
| Garmin FIT archive | `garmin-stats/fit-archive/` | permanent raw activity archive; 219 files / ~64.2 MB locally | one runner | yes | filenames and raw FIT payload must be tenant-scoped |
| Strava archive | `garmin-stats/strava-archive/` | raw summary/detail/stream JSON; 3 files / ~2.1 MB locally | one Strava account | yes | numeric filenames are globally provider-addressed |
| Custom backgrounds | `garmin-stats/backgrounds/` | uploaded setting background; 4 files / ~5.3 MB locally | singleton settings owner | potentially | global filenames and cleanup can affect another user |
| OAuth state nonce | module variable `src/http/oauth.ts` | pending Strava/Withings OAuth callback state | one process-wide state per provider | security-sensitive | not durable and not concurrent-user safe |
| Demo feedback export | sibling of DB: `feeedback.txt` | appends all feedback before demo DB replacement | global | potentially | durable free text outside DB; typo is present in path name |
| Demo DB backup | `DEMO_DB_BACKUP_PATH` | periodic reset source in demo mode | global deployment asset | potentially | restore replaces all live state |
| Garmin sync exchange manifest | `src/jobs/existing_activities.json` during job | temporary filename dedup manifest | global | activity identifiers | durable during execution; deleted afterward |

## 7. Training-plan persistence map

```text
plan_templates (DSL source + unresolved parsed JSON)
  → plan_instances (specific race/start date/pace overrides/timezone/revisions)
    → plan_instance_days (resolved dates, JSON segments, notes, customization)
      → workout_id (stable logical workout identity)
        → workout_associations (actual activity link)
        → workout_segment_alignments (manual quality-segment evidence)
```

- Template: current persistence does not distinguish `SYSTEM TEMPLATE` from `USER TEMPLATE`; actual authoring/editing endpoints treat templates as one global mutable set. Best evidence supports USER-OWNED, not system/common.
- Template children: no separate template-child table; the parsed template structure is JSON in `parsed_plan`.
- Plan instance: runner/race-specific USER-OWNED root.
- Resolved days/workouts: derived from a plan instance; USER-OWNED by inheritance.
- Pace anchors/overrides: `pace_overrides` JSON in `plan_instances`; runner-specific instance data.
- Customizations: `plan_instance_days.customized_at`, day fields, replacement/regeneration paths; inherited from instance.
- Swaps: carried through `workout_id`; no separate swap/audit table exists.
- Active-plan state: no persisted active-plan table/column. It is calculated from global instances/dates and approval state. This is a significant single-user assumption.

Legacy map, DB-only:

```text
training_plans
  → planned_workouts
```

Both are empty, uninitialized by current code, and no longer referenced.

## 8. Activity/body persistence map

```text
activities
  → track_points (required FK, CASCADE)
  → workout_associations (required activity FK, CASCADE)
  → workout_segment_alignments (required activity FK, CASCADE)
  ← date_ranges.activity_id (optional)
  ← plan_instances.target_activity_id (optional)

body_measurements
  standalone measurement roots
```

- Activities have soft-delete/purge markers. Purge retains enough dedup identity (`filename`, etc.) to prevent resync resurrection while clearing heavy data and track points.
- No persisted laps, splits, or pauses table exists.
- Classification is stored on `activities`, not as a child table.
- `source` distinguishes Garmin/Strava; source provider identity is encoded through `filename` convention, not a dedicated provider-account/activity table.
- Body measurements use globally unique `measured_at` and the same soft-delete/purge model.
- Planned-vs-actual associations are persisted through `workout_associations.workout_id`, but the plan-day relationship has no FK.

## 9. Integration persistence map

### Garmin

- Config location: environment (`GARMIN_DEVICE_NAME`).
- Credential location: no Garmin OAuth credential persistence found.
- Account identity persistence: none found.
- Sync state: activity `filename UNIQUE`; permanent FIT archive.
- User scoping today: one global device/archive/database dataset.
- Sensitive material: raw FIT files, telemetry, location.
- Affected tables: `activities`, `track_points`, then association reconciliation.

### Strava

- Config location: environment (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`).
- Credential location: `strava_tokens` singleton DB row.
- Account identity persistence: no provider athlete/account mapping is stored.
- Sync state: `strava-archive/<provider-id>.json`; activity filename uses `strava-<id>.json`.
- User scoping today: one global external account and global activity dedup key.
- Sensitive material: access/refresh token values not inspected; raw activity/stream JSON.
- Affected tables: `strava_tokens`, `activities`, `track_points`, `workout_associations`.

### Withings

- Config location: environment (`WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`, `WITHINGS_REDIRECT_URI`).
- Credential location: `withings_tokens` singleton DB row.
- Account identity persistence: no Withings user/account mapping found.
- Sync state: globally unique body `measured_at`.
- User scoping today: one global external account and one global measurement timeline.
- Sensitive material: access/refresh token values not inspected; health measurements.
- Affected tables: `withings_tokens`, `body_measurements`.

### Other

- Ollama configuration and plan-template AI endpoint/key are environment-backed configuration, not SQLite account records.
- No other durable provider connection table was found.

## 10. Missing multi-user primitives

| Capability | EXISTS / PARTIAL / ABSENT | Evidence |
|---|---|---|
| internal user | ABSENT | no user table/model or owner columns |
| external identity | ABSENT | no issuer/subject/account mapping persistence |
| roles/entitlements | ABSENT | no persisted role/entitlement model |
| web session | ABSENT | no persisted session records; OAuth nonce is module memory only |
| native token/revocation state | ABSENT | no application auth/session token model; provider OAuth tokens are not application authentication |
| publication | ABSENT | no publication/profile/public-share persistence |
| public projection | ABSENT | no persisted public projection |
| audit/security events | ABSENT | no audit/security event table; plan snapshots/revisions are domain state, not audit records |

## 11. SQLite → PostgreSQL portability findings

| Location/table | SQLite construct/assumption | Why it matters later |
|---|---|---|
| `db.ts` | `node:sqlite`, `DatabaseSync` | application currently depends directly on SQLite driver API |
| startup | `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON` | SQLite connection settings; not PostgreSQL equivalents |
| all PK tables | `INTEGER PRIMARY KEY AUTOINCREMENT` | rowid/sequence semantics differ |
| singleton tables | `INTEGER PRIMARY KEY CHECK(id=1)` | singleton modeling must be reconsidered for tenant scope |
| timestamps | `TEXT DEFAULT datetime('now')` | SQLite UTC text representation; PostgreSQL timestamp/time-zone type decision required |
| dates | `TEXT` ISO dates and lexical comparisons | PostgreSQL date/timestamp types change comparison/validation semantics |
| booleans/status flags | INTEGER `purged`, `needs_review` | explicit boolean/type handling needed |
| JSON fields | JSON serialized as `TEXT` (`parsed_plan`, `pace_overrides`, `segments`, snapshots, feedback interest) | JSON validation/index/query behavior differs |
| activity sync | `INSERT OR IGNORE` | PostgreSQL uses `ON CONFLICT DO NOTHING`; conflict targets must be explicit |
| associations/alignments/tokens | SQLite `ON CONFLICT (...) DO UPDATE` | portability is generally direct but conflict constraints/scopes change |
| code | `lastInsertRowid` | PostgreSQL requires `RETURNING` or different result handling |
| activity reporting | SQLite `strftime`, `datetime('now')`, `ROUND` | SQL functions and week semantics differ |
| migrations | `PRAGMA table_info` guarded runtime `ALTER TABLE` | not a formal migration system; PostgreSQL deployment migration strategy must differ |
| `activities.activity_type_id` | no actual FK because SQLite ALTER limitation | PostgreSQL migration should preserve intended integrity consciously |
| global uniqueness | `filename`, `measured_at`, `activity_types.name`, range name, association activity, alignment segment | several conflict domains may need owner/provider context |
| FK behavior | foreign keys enabled only on opened application connection | PostgreSQL enforces declared FKs server-side; undeclared textual relationships remain unenforced |
| plan associations | `workout_id` textual reference with no FK/unique constraint | cannot become safe merely by changing database engine |
| pagination | `LIMIT ? OFFSET ?` | portable syntax, but current page queries have no principal predicate |
| text comparison | ISO text dates and default SQLite collation | PostgreSQL collation/case behavior should be made explicit where user names/identifiers matter |
| nullable sentinels | `approved_at`, `customized_at`, `deleted_at`, nullable fields | null carries lifecycle semantics and must remain intentional |

## 12. Highest-risk current single-user assumptions

1. All activity, telemetry, body, plan, range, and settings queries operate without any user/principal predicate.
2. `strava_tokens` and `withings_tokens` are hard singleton rows (`id=1`); OAuth refresh overwrites the one stored provider connection.
3. `settings` is a hard singleton and drives runner timezone, UI preferences, and custom-background selection.
4. `activities.filename UNIQUE` and `body_measurements.measured_at UNIQUE` are global duplicate-prevention boundaries.
5. Raw FIT and Strava archives are globally named/path-addressed and contain personal activity data; track points include precise latitude/longitude.
6. Plan “active”/candidate/overlap logic queries all plan instances globally by dates and approval state.
7. `workout_id` relationships in association/alignment data are textual and not constrained to an owning plan instance.
8. The OAuth nonce state is only one process-global value per provider, not per browser/session/user.
9. Current persistence does not distinguish user-authored templates from future system templates.

## 13. Ambiguities requiring architecture/product decision

### Template publication/ownership model

Evidence: all current `plan_templates` rows are globally mutable; there is no template ownership, visibility, or system-template discriminator.

Why repository inspection cannot answer it: historical single-user behavior cannot establish whether future templates should be private, shared, copied, or product-owned.

Decision needed: ownership/visibility semantics for templates and whether system templates are distinct persisted entities or a state of a template.

### Feedback classification/access policy

Evidence: feedback is anonymous, write-only in current APIs, and demo mode exports it to a filesystem text file.

Why repository inspection cannot answer it: no feedback administration or retention policy exists.

Decision needed: whether feedback becomes a support/admin resource, its retention/access model, and whether anonymous submissions need a separate privacy policy.

### Legacy `training_plans` / `planned_workouts`

Evidence: they exist in the actual local DB but are empty; current initializer and source code do not reference them.

Why repository inspection cannot answer it: no current code or migration document establishes whether they are obsolete data, a deliberate compatibility holdover, or needed by another deployment/database.

Decision needed: migration disposition for legacy tables before treating the local DB as a PostgreSQL source inventory.

### Cross-root plan/activity links

Evidence: plan instances/ranges can refer to activities; associations and alignments connect activity roots to `workout_id` without a foreign key.

Why repository inspection cannot answer it: the current single-runner model makes all roots co-resident, so desired multi-user behavior for cross-owner links is not expressible.

Decision needed: whether links must always require common ownership and how provider/import identity participates.

## 14. Evidence index

- `AGENTS.md` — repository safety and database-work routing.
- `.claude/rules/backend.md` — Node/SQLite backend conventions.
- `docs/schema.md` — documented current domain semantics, soft delete, plans, associations.
- `docs/ingestion.md` — Garmin FIT and Strava archive behavior.
- `garmin-stats/src/db.ts` — authoritative current initializer, runtime repairs, DB open/WAL/FK behavior, typed row shapes.
- `garmin-stats/src/config.ts` — mandatory `DB_PATH` and integration/demo environment configuration.
- `garmin-stats/src/server.ts` — startup wiring and demo-restore integration.
- `garmin-stats/src/repositories/*.repo.ts` — table-level reads/writes.
- `garmin-stats/src/services/*` — lifecycle, plan, association, reporting behavior.
- `garmin-stats/src/controllers/*` and `src/http/router.ts` — routes exposing persisted features.
- `garmin-stats/src/jobs/sync-garmin.ts`, `sync-strava.ts`, `sync-withings.ts`, `reprocess-fit-archive.ts`, `demo-db-restore.ts` — ingestion, raw archives, lifecycle, and demo durability.
- `garmin-stats/src/integrations/strava.ts`, `withings.ts` — singleton OAuth credential persistence.
- `garmin-stats/src/http/oauth.ts` — in-memory OAuth nonce state.
- `garmin-stats/garmin.db` — database-verified tables, DDL, keys, indexes, FK metadata, and row counts.
