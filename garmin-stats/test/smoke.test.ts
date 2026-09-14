import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedSampleData, SAMPLE_ACTIVITIES } from "./helpers/db.ts";

test("fresh PostgreSQL schema has the runtime tables and founder settings", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const tables = (await db.all<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map(row => row.name);
    for (const table of ["activities", "track_points", "body_measurements", "user_settings"]) {
      assert.ok(tables.includes(table), `expected table ${table} to exist`);
    }
    const settings = await db.get<{ theme: string; unit_system: string; min_trend_group_size: number }>("SELECT theme, unit_system, min_trend_group_size FROM user_settings");
    assert.ok(settings, "founder settings should exist");
    assert.equal(settings.theme, "auto");
    assert.equal(settings.unit_system, "auto");
    assert.equal(settings.min_trend_group_size, 5);
  } finally {
    await cleanup();
  }
});

test("each PostgreSQL test schema is isolated", async () => {
  const a = await createTestDb();
  const b = await createTestDb();
  try {
    await seedSampleData(a.db);
    const aCount = (await a.db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM activities"))!.c;
    const bCount = (await b.db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM activities"))!.c;
    assert.equal(aCount, SAMPLE_ACTIVITIES.length);
    assert.equal(bCount, 0);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("seedSampleData inserts activities, track points and a body measurement", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { activityIds } = await seedSampleData(db);
    assert.equal(activityIds.length, 2);
    const activities = await db.all<{ source: string }>("SELECT source FROM activities ORDER BY id");
    assert.deepEqual(activities.map(activity => activity.source), ["garmin", "strava"]);
    const trackPoints = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM track_points WHERE activity_id = $1", [activityIds[0]]))!.c;
    assert.equal(trackPoints, 3);
    const body = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM body_measurements"))!.c;
    assert.equal(body, 1);
  } finally {
    await cleanup();
  }
});

test("track points cascade-delete with their parent activity", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { activityIds } = await seedSampleData(db);
    await db.run("DELETE FROM activities WHERE id = $1", [activityIds[0]]);
    const points = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM track_points WHERE activity_id = $1", [activityIds[0]]))!.c;
    assert.equal(points, 0);
  } finally {
    await cleanup();
  }
});
