/**
 * test/plan-instance-timezone-migration.test.ts (HRA-332, AC5)
 * The backfill migration for schedule_timezone/original_start_date/
 * original_days_snapshot: builds a DB shaped like a pre-HRA-332 install
 * (plan_instances/plan_instance_days present, but without the three new
 * columns), inserts a legacy instance + days by hand, then runs initSchema()
 * — the same function a real upgrade runs on boot — and asserts the
 * backfill populated Original correctly from the owner-configured
 * settings.timezone, or the documented 'UTC' fallback when that's unset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../src/db.ts";

function buildLegacyDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      outlier_speed_delta_per_sec REAL NOT NULL DEFAULT 2.0,
      outlier_cadence_delta_per_sec REAL NOT NULL DEFAULT 60.0,
      outlier_min_speed_kmh REAL NOT NULL DEFAULT 6.0,
      theme TEXT NOT NULL DEFAULT 'auto',
      background_kind TEXT NOT NULL DEFAULT 'none',
      background_value TEXT,
      unit_system TEXT NOT NULL DEFAULT 'auto',
      timezone TEXT,
      min_trend_group_size INTEGER NOT NULL DEFAULT 5,
      activity_detail_view TEXT NOT NULL DEFAULT 'accordion',
      accent_color TEXT NOT NULL DEFAULT 'sky',
      date_format TEXT NOT NULL DEFAULT 'literal_uk',
      language TEXT NOT NULL DEFAULT 'auto',
      palette TEXT NOT NULL DEFAULT 'metal',
      updated_at TEXT DEFAULT (datetime('now'))
    );
    INSERT INTO settings (id) VALUES (1);

    CREATE TABLE plan_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dsl_source TEXT NOT NULL,
      parsed_plan TEXT NOT NULL, event TEXT, approved_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE plan_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL, pace_overrides TEXT, target_activity_id INTEGER,
      approved_at TEXT, name TEXT, event TEXT, race_name TEXT, race_date TEXT, race_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE plan_instance_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES plan_instances(id) ON DELETE CASCADE,
      section_name TEXT NOT NULL, week_number INTEGER NOT NULL, date TEXT NOT NULL, day INTEGER NOT NULL,
      suffix TEXT, category TEXT, workout_type TEXT NOT NULL, segments TEXT NOT NULL,
      activity_target TEXT, activity_description TEXT, notes TEXT, needs_review INTEGER NOT NULL DEFAULT 0,
      scheduled_time TEXT, customized_at TEXT
    );
  `);
  return db;
}

test("backfill: existing instance gets schedule_timezone from settings.timezone and Original mirrors its current start_date/days", () => {
  const db = buildLegacyDb();
  try {
    db.exec("UPDATE settings SET timezone = 'Europe/Rome' WHERE id = 1");
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name) VALUES (1, 1, '2026-01-05', 'Legacy instance')",
    ).run();
    db.prepare(`
      INSERT INTO plan_instance_days (instance_id, section_name, week_number, date, day, workout_type, segments)
      VALUES (1, 'Base', 1, '2026-01-05', 1, 'run', '[]')
    `).run();

    initSchema(db);

    const row = db.prepare("SELECT schedule_timezone, original_start_date, original_days_snapshot FROM plan_instances WHERE id = 1").get() as {
      schedule_timezone: string; original_start_date: string; original_days_snapshot: string;
    };
    assert.equal(row.schedule_timezone, "Europe/Rome");
    assert.equal(row.original_start_date, "2026-01-05");
    const snapshot = JSON.parse(row.original_days_snapshot);
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].date, "2026-01-05");
    assert.equal(snapshot[0].section_name, "Base");
  } finally {
    db.close();
  }
});

test("backfill: falls back to the documented 'UTC' constant when settings.timezone was never configured", () => {
  const db = buildLegacyDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name) VALUES (1, 1, '2026-01-05', 'Legacy instance')",
    ).run();

    initSchema(db);

    const row = db.prepare("SELECT schedule_timezone FROM plan_instances WHERE id = 1").get() as { schedule_timezone: string };
    assert.equal(row.schedule_timezone, "UTC");
  } finally {
    db.close();
  }
});

test("backfill: running initSchema again is a no-op (idempotent, never overwrites an already-backfilled row)", () => {
  const db = buildLegacyDb();
  try {
    db.exec("UPDATE settings SET timezone = 'Europe/Rome' WHERE id = 1");
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name) VALUES (1, 1, '2026-01-05', 'Legacy instance')",
    ).run();
    initSchema(db);
    db.exec("UPDATE plan_instances SET schedule_timezone = 'Asia/Tokyo' WHERE id = 1"); // simulate a post-migration correction
    initSchema(db);

    const row = db.prepare("SELECT schedule_timezone FROM plan_instances WHERE id = 1").get() as { schedule_timezone: string };
    assert.equal(row.schedule_timezone, "Asia/Tokyo", "a second initSchema() run must not clobber an already-set value");
  } finally {
    db.close();
  }
});
