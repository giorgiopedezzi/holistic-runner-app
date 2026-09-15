/**
 * test/jobs/fit-dedup-tenancy.test.ts (HRA-352 follow-up)
 * Proves the actual dedup contract jobs/sync-garmin.ts, jobs/sync-strava.ts,
 * jobs/sync-withings.ts, and jobs/reprocess-fit-archive.ts rely on: the same
 * `INSERT ... ON CONFLICT (user_id, filename|measured_at) DO NOTHING`
 * statements those jobs run, and the same `WHERE user_id=$1 AND filename=$2`
 * lookup reprocess-fit-archive.ts runs, exercised directly against the real
 * schema/constraints from db/migrations/001_postgresql_foundation.sql. The
 * jobs themselves are script entry points (not exported functions) spawned
 * as child processes — test/helpers/server.ts deliberately never spawns
 * them in tests — so this proves the security boundary those jobs depend on
 * (the unique constraint + the exact SQL they issue), not a re-run of the
 * scripts themselves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDb } from "../helpers/db.ts";

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

// Mirrors jobs/sync-garmin.ts's (and sync-strava.ts's) real INSERT statement.
async function insertActivity(db: Awaited<ReturnType<typeof createTestDb>>["db"], userId: string, filename: string) {
  return db.get<{ id: number }>(
    `INSERT INTO activities (user_id, filename, activity_date, date_only, sport, source)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, filename) DO NOTHING RETURNING id`,
    [userId, filename, "2026-08-04T10:00:00", "2026-08-04", "running", "garmin"],
  );
}

// Mirrors jobs/sync-withings.ts's real INSERT statement.
async function insertBodyMeasurement(db: Awaited<ReturnType<typeof createTestDb>>["db"], userId: string, measuredAt: string) {
  return db.get<{ id: number }>(
    `INSERT INTO body_measurements (user_id, measured_at, date_only, weight_kg)
     VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, measured_at) DO NOTHING RETURNING id`,
    [userId, measuredAt, measuredAt.slice(0, 10), 70.5],
  );
}

test("Garmin/Strava FIT import: re-importing the same filename for one owner is idempotent (no duplicate row)", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const first = await insertActivity(db, userId, "2026-08-04-10-28-43.fit");
    const second = await insertActivity(db, userId, "2026-08-04-10-28-43.fit");
    assert.ok(first);
    assert.equal(second, undefined); // ON CONFLICT DO NOTHING — no row returned

    const count = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM activities WHERE user_id=$1 AND filename=$2", [userId, "2026-08-04-10-28-43.fit"]);
    assert.equal(count?.n, 1);
  } finally { await cleanup(); }
});

test("the same external filename belonging to a DIFFERENT owner is not treated as a collision — each owner gets their own row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    const filename = "2026-08-04-10-28-43.fit"; // e.g. two Forerunners that happened to log at the same timestamp

    const rowA = await insertActivity(db, userA, filename);
    const rowB = await insertActivity(db, userB, filename);
    assert.ok(rowA && rowB);
    assert.notEqual(rowA.id, rowB.id);

    const total = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM activities WHERE filename=$1", [filename]);
    assert.equal(total?.n, 2);
  } finally { await cleanup(); }
});

test("Withings body-measurement import: re-importing the same measured_at for one owner is idempotent", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const measuredAt = "2026-08-01T06:30:00";
    const first = await insertBodyMeasurement(db, userId, measuredAt);
    const second = await insertBodyMeasurement(db, userId, measuredAt);
    assert.ok(first);
    assert.equal(second, undefined);

    const count = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM body_measurements WHERE user_id=$1 AND measured_at=$2", [userId, measuredAt]);
    assert.equal(count?.n, 1);
  } finally { await cleanup(); }
});

test("the same measured_at belonging to a different owner does not collide", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    const measuredAt = "2026-08-01T06:30:00";
    const rowA = await insertBodyMeasurement(db, userA, measuredAt);
    const rowB = await insertBodyMeasurement(db, userB, measuredAt);
    assert.ok(rowA && rowB);
    assert.notEqual(rowA.id, rowB.id);
  } finally { await cleanup(); }
});

test("jobs/reprocess-fit-archive.ts's owner-scoped lookup never resolves a filename to another owner's activity", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    const filename = "2026-08-04-10-28-43.fit";
    const rowA = await insertActivity(db, userA, filename);
    assert.ok(rowA);
    // userB never imported this filename — the reprocess job's exact lookup
    // (see jobs/reprocess-fit-archive.ts) must find nothing for userB,
    // never fall through to userA's row.
    const foundForB = await db.get<{ id: number }>("SELECT id FROM activities WHERE user_id=$1 AND filename=$2", [userB, filename]);
    assert.equal(foundForB, undefined);
    const foundForA = await db.get<{ id: number }>("SELECT id FROM activities WHERE user_id=$1 AND filename=$2", [userA, filename]);
    assert.equal(foundForA?.id, rowA.id);
  } finally { await cleanup(); }
});

test("a purged (soft-deleted) activity's filename still blocks reimport for the SAME owner only, never for a different owner", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    const filename = "2026-08-04-10-28-43.fit";
    const rowA = await insertActivity(db, userA, filename);
    assert.ok(rowA);
    // Purge, same as POST /api/v1/activities/purge — filename survives per
    // docs/schema.md's soft-delete model, which is what stops a resync from
    // silently reimporting a deliberately-deleted activity.
    await db.run("UPDATE activities SET deleted_at=now()::text, purged=true, distance_m=NULL WHERE id=$1", [rowA.id]);

    const reimportA = await insertActivity(db, userA, filename);
    assert.equal(reimportA, undefined); // still blocked for the same owner

    const importB = await insertActivity(db, userB, filename);
    assert.ok(importB); // a different owner's purge history never blocks another owner
  } finally { await cleanup(); }
});
