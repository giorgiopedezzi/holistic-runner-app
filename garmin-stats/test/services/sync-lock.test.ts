/**
 * test/services/sync-lock.test.ts (HRA-352 AC7/AC8)
 * services/sync-lock.ts's per-(user, provider) run lock: a second sync
 * attempt for the same owner+provider while one is still 'running' is
 * rejected instead of racing the first; a different owner or a different
 * provider for the same owner is never blocked by it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquireSyncLock, releaseSyncLock, SyncAlreadyRunningError } from "../../src/services/sync-lock.ts";
import { createTestDb } from "../helpers/db.ts";

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

test("a second sync for the same owner+provider while one is running is rejected", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    await acquireSyncLock(db, userId, "strava");
    await assert.rejects(() => acquireSyncLock(db, userId, "strava"), SyncAlreadyRunningError);
  } finally { await cleanup(); }
});

test("releasing the lock lets a subsequent sync for the same owner+provider acquire it again", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const runId = await acquireSyncLock(db, userId, "strava");
    await releaseSyncLock(db, runId, { status: "succeeded", imported: 3, skipped: 1, errors: 0 });

    const secondRunId = await acquireSyncLock(db, userId, "strava");
    assert.notEqual(secondRunId, runId);
  } finally { await cleanup(); }
});

test("a different owner is never blocked by another owner's in-flight sync for the same provider", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    await acquireSyncLock(db, userA, "withings");
    const runId = await acquireSyncLock(db, userB, "withings");
    assert.ok(runId);
  } finally { await cleanup(); }
});

test("a different provider for the same owner is never blocked by an in-flight sync of another provider", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    await acquireSyncLock(db, userId, "garmin");
    const runId = await acquireSyncLock(db, userId, "strava");
    assert.ok(runId);
  } finally { await cleanup(); }
});

test("a failed run releases the lock the same as a succeeded one", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const runId = await acquireSyncLock(db, userId, "garmin");
    await releaseSyncLock(db, runId, { status: "failed", errorMessage: "device offline" });

    const secondRunId = await acquireSyncLock(db, userId, "garmin");
    assert.ok(secondRunId);
  } finally { await cleanup(); }
});
