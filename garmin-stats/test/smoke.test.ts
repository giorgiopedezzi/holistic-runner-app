/**
 * test/smoke.test.ts
 * Proves the backend test harness runs (HRA-59): node:test executes .ts natively,
 * the fixture builds a fresh schema'd DB, and the seed data lands as expected.
 * The real assertions of behavior live in T2 (domain) and T3 (API/integration).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedSampleData, SAMPLE_ACTIVITIES } from "./helpers/db.ts";

test("fresh DB has the schema and the seeded settings singleton", () => {
  const { db, cleanup } = createTestDb();
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["activities", "track_points", "body_measurements", "settings"]) {
      assert.ok(tables.includes(t), `expected table ${t} to exist`);
    }

    // initSchema INSERT OR IGNOREs the id=1 settings row with column defaults.
    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as
      | { theme: string; unit_system: string; min_trend_group_size: number }
      | undefined;
    assert.ok(settings, "settings singleton row should exist");
    assert.equal(settings.theme, "auto");
    assert.equal(settings.unit_system, "auto");
    assert.equal(settings.min_trend_group_size, 5);
  } finally {
    cleanup();
  }
});

test("each createTestDb() is isolated (no shared state)", () => {
  const a = createTestDb();
  const b = createTestDb();
  try {
    seedSampleData(a.db);
    const aCount = (a.db.prepare("SELECT COUNT(*) AS c FROM activities").get() as { c: number }).c;
    const bCount = (b.db.prepare("SELECT COUNT(*) AS c FROM activities").get() as { c: number }).c;
    assert.equal(aCount, SAMPLE_ACTIVITIES.length);
    assert.equal(bCount, 0, "a second DB must not see the first's writes");
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

test("seedSampleData inserts activities, track points and a body measurement", () => {
  const { db, cleanup } = createTestDb();
  try {
    const { activityIds } = seedSampleData(db);
    assert.equal(activityIds.length, 2);

    const acts = db.prepare("SELECT source FROM activities ORDER BY id").all() as { source: string }[];
    assert.deepEqual(acts.map((a) => a.source), ["garmin", "strava"]);

    const tpCount = (db
      .prepare("SELECT COUNT(*) AS c FROM track_points WHERE activity_id = ?")
      .get(activityIds[0]) as { c: number }).c;
    assert.equal(tpCount, 3);

    const bodyCount = (db.prepare("SELECT COUNT(*) AS c FROM body_measurements").get() as { c: number }).c;
    assert.equal(bodyCount, 1);
  } finally {
    cleanup();
  }
});

test("track_points CASCADE-delete when the parent activity is hard-deleted (FK on)", () => {
  const { db, cleanup } = createTestDb();
  try {
    const { activityIds } = seedSampleData(db);
    db.prepare("DELETE FROM activities WHERE id = ?").run(activityIds[0]);
    const tpCount = (db
      .prepare("SELECT COUNT(*) AS c FROM track_points WHERE activity_id = ?")
      .get(activityIds[0]) as { c: number }).c;
    assert.equal(tpCount, 0, "foreign_keys=ON should cascade-delete the track points");
  } finally {
    cleanup();
  }
});
