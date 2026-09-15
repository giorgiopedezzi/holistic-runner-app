/**
 * test/http/oauth-state.test.ts (HRA-352 AC3/AC4/AC12)
 * http/oauth.ts's server-side state store: minted per-user, single-use,
 * expiring, and every failure mode collapsing to the same outcome — so a
 * replay or a state swapped between users/providers never succeeds and never
 * reveals which specific check failed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOauthState, consumeOauthState } from "../../src/http/oauth.ts";
import { createTestDb } from "../helpers/db.ts";

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

test("a freshly minted state consumes exactly once — the second consume (replay) fails", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const state = await createOauthState(db, userId, "withings", "http://localhost:3002/callback");

    const first = await consumeOauthState(db, state, "withings");
    assert.deepEqual(first, { userId });

    const replay = await consumeOauthState(db, state, "withings");
    assert.equal(replay, null);
  } finally { await cleanup(); }
});

test("consuming a state under the wrong provider fails — a state minted for one provider can't be swapped onto another", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const state = await createOauthState(db, userId, "strava", "http://localhost:3001/api/v1/strava/callback");

    const swapped = await consumeOauthState(db, state, "withings");
    assert.equal(swapped, null);

    // The mismatch above must not have burned the token — it's still usable
    // under its real provider (a wrong-provider guess costs the attacker
    // nothing extra to learn, and costs the real user nothing either).
    const real = await consumeOauthState(db, state, "strava");
    assert.deepEqual(real, { userId });
  } finally { await cleanup(); }
});

test("an unknown/guessed state token consumes to null, indistinguishable from an expired or already-used one", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const guessed = await consumeOauthState(db, "not-a-real-token", "withings");
    assert.equal(guessed, null);
  } finally { await cleanup(); }
});

test("an expired state fails to consume even though it was never used", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    const state = await createOauthState(db, userId, "withings", "http://localhost:3002/callback");
    await db.run("UPDATE oauth_states SET expires_at = now() - interval '1 minute' WHERE token = $1", [state]);

    const consumed = await consumeOauthState(db, state, "withings");
    assert.equal(consumed, null);
  } finally { await cleanup(); }
});

test("two users each get their own independent state, and one user's state never resolves to another user's id", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    const stateA = await createOauthState(db, userA, "strava", "http://localhost:3001/api/v1/strava/callback");
    const stateB = await createOauthState(db, userB, "strava", "http://localhost:3001/api/v1/strava/callback");

    const resolvedB = await consumeOauthState(db, stateB, "strava");
    assert.deepEqual(resolvedB, { userId: userB });
    const resolvedA = await consumeOauthState(db, stateA, "strava");
    assert.deepEqual(resolvedA, { userId: userA });
  } finally { await cleanup(); }
});
