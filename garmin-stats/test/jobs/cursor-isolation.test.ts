/**
 * test/jobs/cursor-isolation.test.ts (HRA-352 follow-up — two-user adversarial: cursor/sync state)
 * jobs/sync-strava.ts and jobs/sync-withings.ts each compute an incremental
 * "since" cursor via `SELECT MAX(activity_date|measured_at) ... WHERE
 * user_id=$1`. Proves that query is genuinely owner-scoped: a later-dated
 * row belonging to a DIFFERENT owner must never advance (or leak into) this
 * owner's own cursor.
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

// Mirrors jobs/sync-strava.ts's real cursor query.
function stravaCursor(db: Awaited<ReturnType<typeof createTestDb>>["db"], userId: string) {
  return db.get<{ last: string | null }>("SELECT MAX(activity_date) AS last FROM activities WHERE source = 'strava' AND user_id = $1", [userId]);
}

// Mirrors jobs/sync-withings.ts's real cursor query.
function withingsCursor(db: Awaited<ReturnType<typeof createTestDb>>["db"], userId: string) {
  return db.get<{ last: string | null }>("SELECT MAX(measured_at) AS last FROM body_measurements WHERE user_id = $1", [userId]);
}

test("Strava sync cursor: a later activity belonging to a different owner never advances this owner's own cursor", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    await db.run(
      "INSERT INTO activities (user_id, filename, activity_date, date_only, source) VALUES ($1,$2,$3,$4,$5)",
      [userA, "strava-1.json", "2026-01-01T06:00:00", "2026-01-01", "strava"],
    );
    // B's own activity is deliberately EARLIER than A's — if the cursor
    // query were unscoped, B's cursor would incorrectly jump to A's later date.
    await db.run(
      "INSERT INTO activities (user_id, filename, activity_date, date_only, source) VALUES ($1,$2,$3,$4,$5)",
      [userB, "strava-2.json", "2025-06-01T06:00:00", "2025-06-01", "strava"],
    );

    const cursorA = await stravaCursor(db, userA);
    const cursorB = await stravaCursor(db, userB);
    assert.match(cursorA?.last ?? "", /^2026-01-01/);
    assert.match(cursorB?.last ?? "", /^2025-06-01/);
  } finally { await cleanup(); }
});

test("Strava sync cursor: an owner with no Strava activities of their own gets a null cursor, never another owner's", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userWithData = await makeUser(db);
    const userWithoutData = await makeUser(db);
    await db.run(
      "INSERT INTO activities (user_id, filename, activity_date, date_only, source) VALUES ($1,$2,$3,$4,$5)",
      [userWithData, "strava-1.json", "2026-01-01T06:00:00", "2026-01-01", "strava"],
    );
    const cursor = await stravaCursor(db, userWithoutData);
    assert.equal(cursor?.last, null);
  } finally { await cleanup(); }
});

test("Withings sync cursor: a later measurement belonging to a different owner never advances this owner's own cursor", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    await db.run(
      "INSERT INTO body_measurements (user_id, measured_at, date_only, weight_kg) VALUES ($1,$2,$3,$4)",
      [userA, "2026-01-01T06:00:00", "2026-01-01", 70],
    );
    await db.run(
      "INSERT INTO body_measurements (user_id, measured_at, date_only, weight_kg) VALUES ($1,$2,$3,$4)",
      [userB, "2025-06-01T06:00:00", "2025-06-01", 65],
    );

    const cursorA = await withingsCursor(db, userA);
    const cursorB = await withingsCursor(db, userB);
    assert.match(cursorA?.last ?? "", /^2026-01-01/);
    assert.match(cursorB?.last ?? "", /^2025-06-01/);
  } finally { await cleanup(); }
});
