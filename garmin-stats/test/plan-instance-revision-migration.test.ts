/**
 * test/plan-instance-revision-migration.test.ts (HRA-336)
 * The current_revision/original_revision migration: builds a DB shaped like
 * a pre-HRA-336 install (plan_instances present, but without the two new
 * columns), inserts a legacy instance by hand, then runs initSchema() — the
 * same function a real upgrade runs on boot — and asserts both columns land
 * at 1 for the existing row, with no other column touched.
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
    -- Shaped like a post-HRA-332/HRA-121 instance, but deliberately WITHOUT
    -- current_revision/original_revision — this Story's own migration target.
    CREATE TABLE plan_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES plan_templates(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL, pace_overrides TEXT, target_activity_id INTEGER,
      approved_at TEXT, name TEXT, event TEXT, race_name TEXT, race_date TEXT, race_url TEXT,
      schedule_timezone TEXT, original_start_date TEXT, original_days_snapshot TEXT,
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

test("migration: an existing plan_instances row backfills current_revision=1 and original_revision=1", () => {
  const db = buildLegacyDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(`
      INSERT INTO plan_instances (id, template_id, start_date, name, schedule_timezone, original_start_date, original_days_snapshot)
      VALUES (1, 1, '2026-01-05', 'Legacy instance', 'Europe/Rome', '2026-01-05', '[]')
    `).run();

    initSchema(db);

    const row = db.prepare("SELECT current_revision, original_revision, start_date, name FROM plan_instances WHERE id = 1").get() as {
      current_revision: number; original_revision: number; start_date: string; name: string;
    };
    assert.equal(row.current_revision, 1);
    assert.equal(row.original_revision, 1);
    assert.equal(row.start_date, "2026-01-05", "the migration must never touch unrelated columns");
    assert.equal(row.name, "Legacy instance");
  } finally {
    db.close();
  }
});

test("migration: running initSchema again never resets an already-advanced revision", () => {
  const db = buildLegacyDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(`
      INSERT INTO plan_instances (id, template_id, start_date, name)
      VALUES (1, 1, '2026-01-05', 'Legacy instance')
    `).run();
    initSchema(db);
    db.exec("UPDATE plan_instances SET current_revision = 4, original_revision = 2 WHERE id = 1"); // simulate real edits since migration
    initSchema(db);

    const row = db.prepare("SELECT current_revision, original_revision FROM plan_instances WHERE id = 1").get() as {
      current_revision: number; original_revision: number;
    };
    assert.equal(row.current_revision, 4, "a second initSchema() run must not clobber an already-advanced revision");
    assert.equal(row.original_revision, 2);
  } finally {
    db.close();
  }
});
