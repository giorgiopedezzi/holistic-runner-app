/**
 * test/plan-instance-workout-id-migration.test.ts (HRA-333, AC2)
 * The backfill migration for plan_instance_days.workout_id: builds a DB
 * shaped like a post-HRA-332, pre-HRA-333 install (schedule_timezone/
 * original_start_date/original_days_snapshot present, but no workout_id
 * column anywhere), inserts a legacy instance + days + a matching Original
 * snapshot by hand, then runs initSchema() — the same function a real
 * upgrade runs on boot — and asserts every Current day gets a fresh,
 * distinct identity and the Original snapshot's matching days inherit the
 * same ids as their Current counterparts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initSchema } from "../src/db.ts";

function buildPreWorkoutIdDb(): DatabaseSync {
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

test("backfill: every existing plan_instance_days row gets its own fresh, distinct workout_id", () => {
  const db = buildPreWorkoutIdDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name, schedule_timezone, original_start_date, original_days_snapshot) " +
      "VALUES (1, 1, '2026-01-05', 'Legacy instance', 'UTC', '2026-01-05', '[]')",
    ).run();
    db.prepare(`
      INSERT INTO plan_instance_days (instance_id, section_name, week_number, date, day, workout_type, segments)
      VALUES (1, 'Base', 1, '2026-01-05', 1, 'run', '[]'), (1, 'Base', 1, '2026-01-06', 2, 'run', '[]')
    `).run();

    initSchema(db);

    const rows = db.prepare("SELECT id, workout_id FROM plan_instance_days ORDER BY id").all() as { id: number; workout_id: string }[];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(typeof row.workout_id, "string");
      assert.ok(row.workout_id.length > 0);
    }
    assert.notEqual(rows[0].workout_id, rows[1].workout_id);
  } finally {
    db.close();
  }
});

test("backfill: an Original snapshot day matching a Current row by (section_name, week_number, day) inherits that row's fresh workout_id", () => {
  const db = buildPreWorkoutIdDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    // Original mirrors Current exactly (the pre-freeze HRA-332 invariant) —
    // same shape as plan_instance_days rows, minus id/instance_id.
    const snapshot = JSON.stringify([{
      section_name: "Base", week_number: 1, date: "2026-01-05", day: 1, suffix: null, category: null,
      workout_type: "run", segments: "[]", activity_target: null, activity_description: null, notes: null,
      needs_review: 0, scheduled_time: null, customized_at: null,
    }]);
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name, schedule_timezone, original_start_date, original_days_snapshot) " +
      "VALUES (1, 1, '2026-01-05', 'Legacy instance', 'UTC', '2026-01-05', ?)",
    ).run(snapshot);
    db.prepare(`
      INSERT INTO plan_instance_days (instance_id, section_name, week_number, date, day, workout_type, segments)
      VALUES (1, 'Base', 1, '2026-01-05', 1, 'run', '[]')
    `).run();

    initSchema(db);

    const currentWorkoutId = (db.prepare("SELECT workout_id FROM plan_instance_days WHERE instance_id = 1").get() as { workout_id: string }).workout_id;
    const updatedSnapshot = JSON.parse(
      (db.prepare("SELECT original_days_snapshot FROM plan_instances WHERE id = 1").get() as { original_days_snapshot: string }).original_days_snapshot,
    );
    assert.equal(updatedSnapshot.length, 1);
    assert.equal(updatedSnapshot[0].workout_id, currentWorkoutId, "Original and Current must agree on identity for a not-yet-diverged instance");
  } finally {
    db.close();
  }
});

test("backfill: an Original snapshot day with no matching Current row (already removed) gets its own independent fresh id", () => {
  const db = buildPreWorkoutIdDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    // Original has a day (week 1) that Current no longer has — it was
    // removed from Current after freeze, so no (section,week,day) match exists.
    const snapshot = JSON.stringify([{
      section_name: "Base", week_number: 1, date: "2026-01-05", day: 1, suffix: null, category: null,
      workout_type: "run", segments: "[]", activity_target: null, activity_description: null, notes: null,
      needs_review: 0, scheduled_time: null, customized_at: null,
    }]);
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name, schedule_timezone, original_start_date, original_days_snapshot) " +
      "VALUES (1, 1, '2026-01-05', 'Legacy instance', 'UTC', '2026-01-05', ?)",
    ).run(snapshot);
    // Current only has week 2 now (week 1's day was removed).
    db.prepare(`
      INSERT INTO plan_instance_days (instance_id, section_name, week_number, date, day, workout_type, segments)
      VALUES (1, 'Base', 2, '2026-01-12', 1, 'run', '[]')
    `).run();

    initSchema(db);

    const currentWorkoutId = (db.prepare("SELECT workout_id FROM plan_instance_days WHERE instance_id = 1").get() as { workout_id: string }).workout_id;
    const updatedSnapshot = JSON.parse(
      (db.prepare("SELECT original_days_snapshot FROM plan_instances WHERE id = 1").get() as { original_days_snapshot: string }).original_days_snapshot,
    );
    assert.equal(typeof updatedSnapshot[0].workout_id, "string");
    assert.ok(updatedSnapshot[0].workout_id.length > 0);
    assert.notEqual(updatedSnapshot[0].workout_id, currentWorkoutId, "an orphaned Original day must never collide with an unrelated Current workout's id");
  } finally {
    db.close();
  }
});

test("backfill: running initSchema again is a no-op (idempotent, never reassigns an already-backfilled workout_id)", () => {
  const db = buildPreWorkoutIdDb();
  try {
    db.prepare("INSERT INTO plan_templates (id, name, dsl_source, parsed_plan) VALUES (1, 'T', 'PLAN', '{}')").run();
    db.prepare(
      "INSERT INTO plan_instances (id, template_id, start_date, name, schedule_timezone, original_start_date, original_days_snapshot) " +
      "VALUES (1, 1, '2026-01-05', 'Legacy instance', 'UTC', '2026-01-05', '[]')",
    ).run();
    db.prepare(`
      INSERT INTO plan_instance_days (instance_id, section_name, week_number, date, day, workout_type, segments)
      VALUES (1, 'Base', 1, '2026-01-05', 1, 'run', '[]')
    `).run();
    initSchema(db);
    const firstWorkoutId = (db.prepare("SELECT workout_id FROM plan_instance_days WHERE instance_id = 1").get() as { workout_id: string }).workout_id;

    initSchema(db);

    const secondWorkoutId = (db.prepare("SELECT workout_id FROM plan_instance_days WHERE instance_id = 1").get() as { workout_id: string }).workout_id;
    assert.equal(secondWorkoutId, firstWorkoutId, "a second initSchema() run must not reassign an already-backfilled workout_id");
  } finally {
    db.close();
  }
});
