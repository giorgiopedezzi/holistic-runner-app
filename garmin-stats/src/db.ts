import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getArg, CONFIG_DIR } from "./config.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const config  = loadConfig();
// Resolved against CONFIG_DIR (not process.cwd()) so the same config.json
// always points at the same database file, regardless of where a script
// or IDE run configuration happens to launch node from.
const DB_PATH_ARG = getArg("--db");
const DB_PATH = DB_PATH_ARG ? path.resolve(DB_PATH_ARG) : path.resolve(CONFIG_DIR, config.database.path);

export type Db = DatabaseSync;

// Re-export so other modules don't need to import node:sqlite directly
export type { SQLInputValue };
export type SQLParams = Record<string, SQLInputValue>;

export function openDb(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      filename        TEXT    UNIQUE NOT NULL,
      activity_date   TEXT    NOT NULL,
      date_only       TEXT    NOT NULL,
      sport           TEXT,
      duration_sec    REAL,
      distance_m      REAL,
      avg_pace_minkm  REAL,
      calories        INTEGER,
      avg_hr          INTEGER,
      max_hr          INTEGER,
      avg_cadence     INTEGER,
      ascent_m        REAL,
      descent_m       REAL,
      avg_speed_ms    REAL,
      max_speed_ms    REAL,
      source          TEXT    NOT NULL DEFAULT 'garmin',
      moving_time_sec REAL,
      imported_at     TEXT    DEFAULT (datetime('now')),
      -- Soft delete: deleted_at NULL = active. Non-NULL = in the trash
      -- (still fully intact, restorable). purged=1 means the trash was
      -- emptied for this row — track_points and every heavy summary column
      -- are wiped, but filename/date/source are kept so a resync's
      -- filename-dedup check still finds it and doesn't reimport it (see
      -- CLAUDE.md's soft-delete notes). A purged row is never shown in the
      -- trash UI and can't be restored.
      deleted_at      TEXT,
      purged          INTEGER NOT NULL DEFAULT 0,
      -- AI workout classifier + feedback correction (all NULL = not yet
      -- classified). The two methods (ai_classification/ai_explanation from
      -- ollama-service.ts, statistical_classification/statistical_explanation
      -- from stats-classifier.ts) are independent, separately-stored slots —
      -- the UI runs them from two separate buttons so the user can compare
      -- both results side by side, and running one never overwrites or
      -- clears the other. Each is persisted as soon as it's computed, before
      -- any human review (a "pending" classification is still a stored one).
      -- user_feedback is NULL (pending review, "yellow") until the user
      -- thumbs up/down *one specific* result ('approved'/'rejected',
      -- "green") — there is exactly one shared verdict per activity, not one
      -- per method. final_classification is the reviewed ground truth: the
      -- approved card's classification, or the user's corrected pick on
      -- rejection. classification_method here records which card (ai or
      -- statistical) the verdict came from — set at feedback time, not
      -- classify time. Reclassifying either method always resets
      -- user_feedback/user_correction_reason/final_classification/
      -- classification_method back to NULL — a fresh opinion needs fresh
      -- review, old feedback doesn't carry over, even if the reclassified
      -- method wasn't the one the old verdict was about (simplicity over
      -- tracking which specific method's reclassify should or shouldn't
      -- invalidate the shared verdict). Not part of ActivityRow/
      -- activityParams() — same reasoning as deleted_at/purged: populated by
      -- a separate later code path (the classify/feedback routes), not the
      -- sync insert path.
      ai_classification      TEXT,
      ai_explanation         TEXT,
      statistical_classification TEXT,
      statistical_explanation    TEXT,
      user_feedback          TEXT,
      user_correction_reason TEXT,
      final_classification   TEXT,
      classification_method  TEXT
    );

    CREATE TABLE IF NOT EXISTS track_points (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id    INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      elapsed_sec    REAL,
      timestamp_unix INTEGER,
      distance_m     REAL,
      heart_rate     INTEGER,
      speed_ms       REAL,
      cadence        INTEGER,
      altitude_m     REAL,
      temperature    INTEGER,
      power          INTEGER,
      lat            REAL,
      lon            REAL
    );

    CREATE TABLE IF NOT EXISTS body_measurements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      measured_at    TEXT    NOT NULL,
      date_only      TEXT    NOT NULL,
      weight_kg      REAL,
      fat_ratio      REAL,
      fat_mass_kg    REAL,
      muscle_mass_kg REAL,
      hydration_kg   REAL,
      bone_mass_kg   REAL,
      bmi            REAL,
      heart_rate     INTEGER,
      -- Same soft-delete/trash/purge model as activities.deleted_at/purged
      -- above — measured_at (UNIQUE) is what a purged row keeps, blocking
      -- sync-withings.ts's INSERT OR IGNORE from resurrecting it.
      deleted_at     TEXT,
      purged         INTEGER NOT NULL DEFAULT 0,
      UNIQUE(measured_at)
    );

    CREATE TABLE IF NOT EXISTS withings_tokens (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      scope         TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS strava_tokens (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      scope         TEXT,
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- Single global row (id=1), same pattern as *_tokens. Outlier-detection
    -- thresholds are a "change per second" a human can reason about (e.g.
    -- "speed can't plausibly jump more than 2 m/s in one second") rather
    -- than a statistical parameter — see ActivityModal.tsx's outlier logic.
    CREATE TABLE IF NOT EXISTS settings (
      id                            INTEGER PRIMARY KEY CHECK (id = 1),
      outlier_speed_delta_per_sec   REAL NOT NULL DEFAULT 2.0,
      outlier_cadence_delta_per_sec REAL NOT NULL DEFAULT 60.0,
      outlier_min_speed_kmh         REAL NOT NULL DEFAULT 6.0,
      -- Appearance: theme is 'dark' or 'light' once explicitly chosen.
      -- 'auto' is no longer a user-selectable value (removed from
      -- ThemePicker) — it survives here only as this column's DEFAULT, the
      -- internal sentinel for "never explicitly chosen", still meaning
      -- "resolve from the OS's prefers-color-scheme at render time" (applied
      -- via a data-theme attribute, see index.css; resolution happens in
      -- useAppearance.ts's resolveTheme(), which treats it the same as any
      -- other non-dark/light legacy value).
      -- background_kind is 'none' | 'bundled' | 'custom' — 'bundled' selects
      -- one of the shipped CSS-gradient presets by id (background_value),
      -- 'custom' points at an uploaded file's name under
      -- garmin-stats/backgrounds/. unit_system is 'metric' | 'imperial' |
      -- 'auto' (resolved from the browser's locale region — see
      -- utils/units.ts — since there's no direct "OS measurement system"
      -- API available to a web page).
      theme                         TEXT NOT NULL DEFAULT 'auto',
      background_kind               TEXT NOT NULL DEFAULT 'none',
      background_value              TEXT,
      unit_system                   TEXT NOT NULL DEFAULT 'auto',
      -- Overview & Trends: minimum activities (single mode) or groups
      -- (week/month mode) before a sport's trend chart is worth showing —
      -- below this, a "too few activities" message is shown instead. Same
      -- number governs both, see OverviewTab.tsx.
      min_trend_group_size          INTEGER NOT NULL DEFAULT 5,
      -- 'accordion' (default) expands an activity's detail inline in
      -- ActivitiesTab; 'modal' opens it as a popup (the original behavior).
      activity_detail_view          TEXT NOT NULL DEFAULT 'accordion',
      -- Selectable --accent (HRA-95): one of a curated 6-name set (teal,
      -- violet, magenta, amber, sky, lime) — see utils/accent.ts for the
      -- fixed hex + WCAG-verified --on-accent per name. 'sky' is the closest
      -- match to the --accent-blue every theme was seeded to in HRA-94, so
      -- existing installs see the smallest possible jump on upgrade.
      accent_color                  TEXT NOT NULL DEFAULT 'sky',
      -- How every displayed date is formatted app-wide (utils/fmt.ts's
      -- fmtDate on the frontend) — one of 'numeric_uk' (23/03/2026),
      -- 'numeric_us' (03/23/2026), 'literal_uk' (23 Mar 2026, the default —
      -- matches the fixed "dd MMM yyyy" this app used before this setting
      -- existed), 'literal_us' (Mar 23, 2026). Independent of unit_system —
      -- a UK date format doesn't imply metric units or vice versa.
      date_format                   TEXT NOT NULL DEFAULT 'literal_uk',
      -- i18n (HRA-104): 'auto' resolves from navigator.language at render
      -- time (see garmin-dashboard's i18n.ts detectLanguageFromLocale), same
      -- 'auto' idiom as unit_system above — plus the two concrete supported
      -- codes ('en'/'it'). Independent of date_format/unit_system.
      language                      TEXT NOT NULL DEFAULT 'auto',
      updated_at                    TEXT DEFAULT (datetime('now'))
    );

    -- Reference lookup: the kinds of training session an activity can be
    -- tagged as. min_distance_m gates which types are selectable for a given
    -- activity (see activities.activity_type_id below) — an activity shorter
    -- than a type's min_distance_m can't be tagged as that type.
    CREATE TABLE IF NOT EXISTS activity_types (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL UNIQUE,
      min_distance_m REAL NOT NULL DEFAULT 0
    );

    -- Named date ranges the user saves for later recall, e.g. re-loading a
    -- specific "Compare to" window on the Overview & Trends tab without
    -- re-picking both dates by hand, or comparing training blocks (2nd vs 3rd
    -- week of marathon prep). name is UNIQUE so recall-by-name stays
    -- unambiguous — a duplicate save is rejected (409), never silently
    -- overwritten (HRA TBD).
    CREATE TABLE IF NOT EXISTS date_ranges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      from_date   TEXT    NOT NULL,
      to_date     TEXT    NOT NULL,
      -- Optional: the race this training block led up to. One activity can be
      -- the target of many date ranges (e.g. separate "week 2"/"week 3" blocks
      -- both pointing at the same race) — nullable, no UNIQUE. Validated
      -- app-side (activities.controller.ts / date-ranges.controller.ts): must
      -- be a race-type activity (activity_type_id != Training) whose date is
      -- strictly after this range's to_date, never before or during it.
      activity_id INTEGER REFERENCES activities(id),
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- A reusable training-plan template (HRA-112): the RunPlan DSL v1 source
    -- text plus its parsed-but-UNRESOLVED RunPlan (domain/runplan/parser.ts) —
    -- pace stays symbolic (an anchor name, not a number) until instantiation,
    -- which is exactly what makes a template reusable across races: reuse
    -- means overriding a few top-level pace anchors + a start date, not
    -- re-authoring or re-parsing the DSL text. dsl_source is kept alongside
    -- parsed_plan so a structural edit (weeks/days/sections) can be re-parsed
    -- later without losing the original authoring text.
    CREATE TABLE IF NOT EXISTS plan_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      dsl_source  TEXT    NOT NULL,
      parsed_plan TEXT    NOT NULL,
      event       TEXT,
      -- Gate 2 (HRA-113): NULL = not approved. Set only via the explicit
      -- approve endpoint, after a zero-warning save (gate 1). Any subsequent
      -- edit (PUT) clears it back to NULL — approval means "a human signed
      -- off on this exact saved state," not "this currently parses cleanly".
      approved_at TEXT,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- One instantiation of a template for a specific race: the pace/date
    -- overrides applied, and (optionally) the race this instance targets —
    -- same FK/validation pattern as date_ranges.activity_id (race-typed,
    -- dated strictly after the plan's last resolved day).
    CREATE TABLE IF NOT EXISTS plan_instances (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id        INTEGER NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
      start_date         TEXT    NOT NULL,
      pace_overrides     TEXT,
      target_activity_id INTEGER REFERENCES activities(id),
      -- Gate 2 (HRA-113): same semantics as plan_templates.approved_at above.
      approved_at        TEXT,
      created_at         TEXT    DEFAULT (datetime('now'))
    );

    -- One row per resolved day of an instance — concrete date + concrete
    -- per-segment paces (domain/runplan/instantiate.ts's ResolvedDay).
    -- segments is JSON, preserving the DSL's real segment shapes
    -- (continuous/interval/progression/rest_block) and every segment on a
    -- multi-segment day — deliberately NOT flattened to one distance/pace
    -- pair per day (the mistake the rejected HRA-109 design made).
    CREATE TABLE IF NOT EXISTS plan_instance_days (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id           INTEGER NOT NULL REFERENCES plan_instances(id) ON DELETE CASCADE,
      section_name          TEXT    NOT NULL,
      week_number           INTEGER NOT NULL,
      date                  TEXT    NOT NULL,
      day                   INTEGER NOT NULL,
      suffix                TEXT,
      category              TEXT,
      workout_type          TEXT    NOT NULL,
      segments              TEXT    NOT NULL,
      activity_target       TEXT,
      activity_description  TEXT,
      notes                 TEXT,
      needs_review          INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date_only);
    CREATE INDEX IF NOT EXISTS idx_track_activity  ON track_points(activity_id);
    CREATE INDEX IF NOT EXISTS idx_body_date       ON body_measurements(date_only);
    CREATE INDEX IF NOT EXISTS idx_plan_instances_template  ON plan_instances(template_id);
    CREATE INDEX IF NOT EXISTS idx_plan_instance_days_inst  ON plan_instance_days(instance_id);
    CREATE INDEX IF NOT EXISTS idx_plan_instance_days_date  ON plan_instance_days(date);
  `);

  // Ensure the single settings row exists — CREATE TABLE IF NOT EXISTS above
  // creates the table but not a row; column DEFAULTs populate it on first run.
  db.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");

  // Fixed ids (not autoincrement-assigned) so activities.activity_type_id's
  // column DEFAULT below can point at Training (id=1) as a constant — SQLite
  // ALTER TABLE ADD COLUMN DEFAULT must be a literal, not a subquery.
  db.exec(`
    INSERT OR IGNORE INTO activity_types (id, name, min_distance_m) VALUES
      (1, 'Training', 0),
      (2, 'Race 5km', 5000),
      (3, 'Race 10km', 10000),
      (4, 'Half-Marathon', 21097.5),
      (5, 'Marathon', 42195)
  `);

  // Migrations for columns added after activities/track_points already
  // existed in the wild. CREATE TABLE IF NOT EXISTS above won't add columns
  // to an already-existing table, so patch them in directly — idempotent,
  // safe to run every startup.
  const activityCols = db.prepare("PRAGMA table_info(activities)").all() as { name: string }[];
  if (!activityCols.some(c => c.name === "source")) {
    // Existing rows correctly default to 'garmin' (the only source that
    // existed before Strava support was added).
    db.exec("ALTER TABLE activities ADD COLUMN source TEXT NOT NULL DEFAULT 'garmin'");
  }
  if (!activityCols.some(c => c.name === "moving_time_sec")) {
    // NULL for existing rows until reprocess-fit-archive.ts backfills them.
    db.exec("ALTER TABLE activities ADD COLUMN moving_time_sec REAL");
  }
  if (!activityCols.some(c => c.name === "deleted_at")) {
    db.exec("ALTER TABLE activities ADD COLUMN deleted_at TEXT");
  }
  if (!activityCols.some(c => c.name === "purged")) {
    db.exec("ALTER TABLE activities ADD COLUMN purged INTEGER NOT NULL DEFAULT 0");
  }
  if (!activityCols.some(c => c.name === "ai_classification")) {
    db.exec("ALTER TABLE activities ADD COLUMN ai_classification TEXT");
  }
  if (!activityCols.some(c => c.name === "ai_explanation")) {
    db.exec("ALTER TABLE activities ADD COLUMN ai_explanation TEXT");
  }
  // Track whether this is the column's very first creation — the backfill
  // below must run exactly once, right when the split happens, not on every
  // server start afterward (it would be a no-op the second time anyway,
  // since ai_classification is already NULL for the rows it moves, but no
  // reason to re-run it).
  const addingStatisticalSplit = !activityCols.some(c => c.name === "statistical_classification");
  if (addingStatisticalSplit) {
    db.exec("ALTER TABLE activities ADD COLUMN statistical_classification TEXT");
  }
  if (!activityCols.some(c => c.name === "statistical_explanation")) {
    db.exec("ALTER TABLE activities ADD COLUMN statistical_explanation TEXT");
  }
  if (addingStatisticalSplit) {
    // Pre-split rows stored whichever method ran most recently in
    // ai_classification/ai_explanation, with classification_method
    // recording which one produced it. Rows whose last classify call was
    // 'statistical' have their real result sitting in the wrong (ai_*)
    // column post-split — move it to the new statistical_* columns so it
    // shows under the correct card, and clear the old slot since it was
    // never actually an AI result.
    db.exec(`
      UPDATE activities
      SET statistical_classification = ai_classification, statistical_explanation = ai_explanation,
          ai_classification = NULL, ai_explanation = NULL
      WHERE classification_method = 'statistical' AND ai_classification IS NOT NULL
    `);
    // classification_method's meaning also changed — it used to record
    // "which method last ran" (set on every classify), now it only means
    // "which card the confirmed verdict came from" (set on feedback). A
    // pending (never-reviewed) row's old value is stale under the new
    // meaning and would incorrectly mark one card as the confirmed source
    // in the UI even though nothing's been approved/rejected yet.
    db.exec("UPDATE activities SET classification_method = NULL WHERE user_feedback IS NULL AND classification_method IS NOT NULL");
  }
  if (!activityCols.some(c => c.name === "user_feedback")) {
    db.exec("ALTER TABLE activities ADD COLUMN user_feedback TEXT");
  }
  if (!activityCols.some(c => c.name === "user_correction_reason")) {
    db.exec("ALTER TABLE activities ADD COLUMN user_correction_reason TEXT");
  }
  if (!activityCols.some(c => c.name === "final_classification")) {
    db.exec("ALTER TABLE activities ADD COLUMN final_classification TEXT");
  }
  if (!activityCols.some(c => c.name === "classification_method")) {
    db.exec("ALTER TABLE activities ADD COLUMN classification_method TEXT");
  }
  if (!activityCols.some(c => c.name === "activity_type_id")) {
    // Defaults every existing row to Training (id=1, seeded above) —
    // untagged activities are training sessions until a human says otherwise.
    // No REFERENCES clause here: SQLite's ALTER TABLE ADD COLUMN rejects a
    // REFERENCES column paired with a non-NULL DEFAULT ("Cannot add a
    // REFERENCES column with non-NULL default value"). The FK relationship
    // is enforced application-side (activities.controller.ts's setType looks
    // up activityTypes.byId before writing) — CREATE TABLE-time columns
    // elsewhere in this file do get a real REFERENCES; this one can't.
    db.exec("ALTER TABLE activities ADD COLUMN activity_type_id INTEGER NOT NULL DEFAULT 1");
  }
  if (!activityCols.some(c => c.name === "activity_name")) {
    // Free-text label set alongside activity_type_id (e.g. the race's name) —
    // NULL until a human sets it, see controllers/activities.controller.ts's setType.
    db.exec("ALTER TABLE activities ADD COLUMN activity_name TEXT");
  }

  const dateRangeCols = db.prepare("PRAGMA table_info(date_ranges)").all() as { name: string }[];
  if (!dateRangeCols.some(c => c.name === "activity_id")) {
    // Nullable, no DEFAULT — unlike activities.activity_type_id above, a
    // REFERENCES column is fine here since there's no non-NULL DEFAULT to
    // conflict with it.
    db.exec("ALTER TABLE date_ranges ADD COLUMN activity_id INTEGER REFERENCES activities(id)");
  }

  const trackCols = db.prepare("PRAGMA table_info(track_points)").all() as { name: string }[];
  if (!trackCols.some(c => c.name === "timestamp_unix")) {
    db.exec("ALTER TABLE track_points ADD COLUMN timestamp_unix INTEGER");
  }

  const bodyCols = db.prepare("PRAGMA table_info(body_measurements)").all() as { name: string }[];
  if (!bodyCols.some(c => c.name === "deleted_at")) {
    db.exec("ALTER TABLE body_measurements ADD COLUMN deleted_at TEXT");
  }
  if (!bodyCols.some(c => c.name === "purged")) {
    db.exec("ALTER TABLE body_measurements ADD COLUMN purged INTEGER NOT NULL DEFAULT 0");
  }

  const settingsCols = db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
  if (!settingsCols.some(c => c.name === "outlier_min_speed_kmh")) {
    db.exec("ALTER TABLE settings ADD COLUMN outlier_min_speed_kmh REAL NOT NULL DEFAULT 6.0");
  }
  if (!settingsCols.some(c => c.name === "theme")) {
    db.exec("ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'");
  }
  if (!settingsCols.some(c => c.name === "background_kind")) {
    db.exec("ALTER TABLE settings ADD COLUMN background_kind TEXT NOT NULL DEFAULT 'none'");
  }
  if (!settingsCols.some(c => c.name === "background_value")) {
    db.exec("ALTER TABLE settings ADD COLUMN background_value TEXT");
  }
  if (!settingsCols.some(c => c.name === "unit_system")) {
    db.exec("ALTER TABLE settings ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'auto'");
  }
  if (!settingsCols.some(c => c.name === "min_trend_group_size")) {
    db.exec("ALTER TABLE settings ADD COLUMN min_trend_group_size INTEGER NOT NULL DEFAULT 5");
  }
  if (!settingsCols.some(c => c.name === "activity_detail_view")) {
    db.exec("ALTER TABLE settings ADD COLUMN activity_detail_view TEXT NOT NULL DEFAULT 'accordion'");
  }
  if (!settingsCols.some(c => c.name === "accent_color")) {
    db.exec("ALTER TABLE settings ADD COLUMN accent_color TEXT NOT NULL DEFAULT 'sky'");
  }
  if (!settingsCols.some(c => c.name === "date_format")) {
    db.exec("ALTER TABLE settings ADD COLUMN date_format TEXT NOT NULL DEFAULT 'literal_uk'");
  }
  if (!settingsCols.some(c => c.name === "language")) {
    db.exec("ALTER TABLE settings ADD COLUMN language TEXT NOT NULL DEFAULT 'auto'");
  }

  // HRA-113: approval gate columns, added after plan_templates/plan_instances
  // already existed (HRA-112). First migration either table has needed.
  const planTemplateCols = db.prepare("PRAGMA table_info(plan_templates)").all() as { name: string }[];
  if (!planTemplateCols.some(c => c.name === "approved_at")) {
    db.exec("ALTER TABLE plan_templates ADD COLUMN approved_at TEXT");
  }
  const planInstanceCols = db.prepare("PRAGMA table_info(plan_instances)").all() as { name: string }[];
  if (!planInstanceCols.some(c => c.name === "approved_at")) {
    db.exec("ALTER TABLE plan_instances ADD COLUMN approved_at TEXT");
  }
}

// ── Typed row shapes ──────────────────────────────────────────────────────

export interface ActivityRow {
  id: number;
  filename: string;
  activity_date: string;
  date_only: string;
  sport: string | null;
  duration_sec: number | null;
  distance_m: number | null;
  avg_pace_minkm: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  avg_speed_ms: number | null;
  max_speed_ms: number | null;
  source: string;
  moving_time_sec: number | null;
}

export interface TrackPointRow {
  activity_id: number;
  elapsed_sec: number | null;
  timestamp_unix: number | null;
  distance_m: number | null;
  heart_rate: number | null;
  speed_ms: number | null;
  cadence: number | null;
  altitude_m: number | null;
  temperature: number | null;
  power: number | null;
  lat: number | null;
  lon: number | null;
}

export interface BodyMeasurementRow {
  measured_at: string;
  date_only: string;
  weight_kg: number | null;
  fat_ratio: number | null;
  fat_mass_kg: number | null;
  muscle_mass_kg: number | null;
  hydration_kg: number | null;
  bone_mass_kg: number | null;
  bmi: number | null;
  heart_rate: number | null;
}

export interface ActivityTypeRow {
  id: number;
  name: string;
  min_distance_m: number;
}

export interface DateRangeRow {
  id: number;
  name: string;
  from_date: string;
  to_date: string;
  activity_id: number | null;
  created_at: string;
  // Joined from the linked race activity (LEFT JOIN — all null when
  // activity_id is null, or when the linked activity was purged and lost its
  // display fields). See repositories/date-ranges.repo.ts.
  race_date_only: string | null;
  race_activity_name: string | null;
  race_distance_m: number | null;
  race_activity_type_id: number | null;
}

// A race-type activity (activity_type_id != Training), as offered on the
// "link a race" dropdown when saving a date range. See
// controllers/activities.controller.ts's races handler.
export interface RaceRow {
  id: number;
  date_only: string;
  activity_type_id: number;
  activity_name: string | null;
  distance_m: number | null;
}

export interface PlanTemplateRow {
  id: number;
  name: string;
  dsl_source: string;
  // JSON-serialized, pre-resolution RunPlan (domain/runplan/types.ts) — pace
  // stays symbolic until an instance is created from this template.
  parsed_plan: string;
  event: string | null;
  // NULL = not approved (HRA-113 gate 2). Set by POST .../approve; cleared to
  // NULL by any subsequent PUT.
  approved_at: string | null;
  created_at: string;
}

export interface PlanInstanceRow {
  id: number;
  template_id: number;
  start_date: string;
  // JSON-serialized PacePolicy overrides applied at instantiation, kept for
  // provenance (what was actually overridden to produce this instance).
  pace_overrides: string | null;
  target_activity_id: number | null;
  // NULL = not approved (HRA-113 gate 2). Same semantics as
  // PlanTemplateRow.approved_at.
  approved_at: string | null;
  created_at: string;
}

export interface PlanInstanceDayRow {
  id: number;
  instance_id: number;
  section_name: string;
  week_number: number;
  date: string;
  day: number;
  suffix: string | null;
  category: string | null;
  workout_type: string;
  // JSON-serialized ResolvedSegment[] (domain/runplan/instantiate.ts).
  segments: string;
  activity_target: string | null;
  activity_description: string | null;
  notes: string | null;
  needs_review: number;
}

export interface WithingsTokenRow {
  id: 1;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
}

export interface StravaTokenRow {
  id: 1;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
}

export interface SettingsRow {
  outlier_speed_delta_per_sec: number;
  outlier_cadence_delta_per_sec: number;
  // Absolute floor, not delta-based like the two above: any speed sample
  // below this (default 6 km/h = 10:00 min/km, i.e. walking pace or slower)
  // is treated as an outlier outright, regardless of how it compares to its
  // neighbors — a deliberate "running-only" filter, distinct from the
  // isolated-spike noise filter the delta thresholds implement.
  outlier_min_speed_kmh: number;
  theme: string;
  background_kind: string;
  background_value: string | null;
  unit_system: string;
  min_trend_group_size: number;
  activity_detail_view: string;
  accent_color: string;
  date_format: string;
  language: string;
}

// ── Typed param builders ──────────────────────────────────────────────────
// These convert our typed row interfaces into the $-prefixed SQLParams
// that node:sqlite expects, with proper SQLInputValue types.

export function activityParams(a: Omit<ActivityRow, "id" | "imported_at">): SQLParams {
  return {
    $filename:       a.filename,
    $activity_date:  a.activity_date,
    $date_only:      a.date_only,
    $sport:          a.sport,
    $duration_sec:   a.duration_sec,
    $distance_m:     a.distance_m,
    $avg_pace_minkm: a.avg_pace_minkm,
    $calories:       a.calories,
    $avg_hr:         a.avg_hr,
    $max_hr:         a.max_hr,
    $avg_cadence:    a.avg_cadence,
    $ascent_m:       a.ascent_m,
    $descent_m:      a.descent_m,
    $avg_speed_ms:   a.avg_speed_ms,
    $max_speed_ms:   a.max_speed_ms,
    $source:         a.source,
    $moving_time_sec: a.moving_time_sec,
  };
}

export function trackPointParams(p: TrackPointRow): SQLParams {
  return {
    $activity_id: p.activity_id,
    $elapsed_sec: p.elapsed_sec,
    $timestamp_unix: p.timestamp_unix,
    $distance_m:  p.distance_m,
    $heart_rate:  p.heart_rate,
    $speed_ms:    p.speed_ms,
    $cadence:     p.cadence,
    $altitude_m:  p.altitude_m,
    $temperature: p.temperature,
    $power:       p.power,
    $lat:         p.lat,
    $lon:         p.lon,
  };
}

export function bodyMeasurementParams(r: BodyMeasurementRow): SQLParams {
  return {
    $measured_at:    r.measured_at,
    $date_only:      r.date_only,
    $weight_kg:      r.weight_kg,
    $fat_ratio:      r.fat_ratio,
    $fat_mass_kg:    r.fat_mass_kg,
    $muscle_mass_kg: r.muscle_mass_kg,
    $hydration_kg:   r.hydration_kg,
    $bone_mass_kg:   r.bone_mass_kg,
    $bmi:            r.bmi,
    $heart_rate:     r.heart_rate,
  };
}
