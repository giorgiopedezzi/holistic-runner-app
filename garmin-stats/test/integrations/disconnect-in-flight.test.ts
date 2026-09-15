/**
 * test/integrations/disconnect-in-flight.test.ts (HRA-352 follow-up)
 * Closes the previously-acknowledged gap: a disconnect landing while a sync
 * job is mid-run must stop that job from persisting further provider-derived
 * state, and a login flow started before disconnect must not resurrect the
 * connection after disconnect. Narrowest fix compatible with the existing
 * synchronous child-process architecture — no queue/supervisor: every write
 * site re-checks `isConnectionActive` (withings.ts/strava.ts), and
 * disconnect() invalidates any still-pending oauth_states row for that
 * (user, provider).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../src/config.ts";
import { clientQueryable } from "../../src/db/query.ts";
import { createOauthState, consumeOauthState } from "../../src/http/oauth.ts";
import * as withings from "../../src/integrations/withings.ts";
import * as strava from "../../src/integrations/strava.ts";
import { createTestDb } from "../helpers/db.ts";

const ENV_KEYS = ["WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.WITHINGS_CLIENT_ID = "test"; process.env.WITHINGS_CLIENT_SECRET = "test"; process.env.WITHINGS_REDIRECT_URI = "http://localhost:3002/callback";
  process.env.STRAVA_CLIENT_ID = "test"; process.env.STRAVA_CLIENT_SECRET = "test"; process.env.STRAVA_REDIRECT_URI = "http://localhost:3001/api/v1/strava/callback";
});

function mockWithingsExchange(userid: string) {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    status: 0, body: { access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: "user.metrics", userid },
  }), { status: 200 })) as typeof fetch;
}
function mockStravaExchange(athleteId: number) {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    access_token: "access", refresh_token: "refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: athleteId },
  }), { status: 200 })) as typeof fetch;
}

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test("isConnectionActive: true while connected, false the instant disconnect removes the row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockWithingsExchange("acct-1");
    await withings.exchangeCode(config, db, userId, "code");

    assert.equal(await withings.isConnectionActive(db, userId), true);
    await withings.disconnect(db, userId);
    assert.equal(await withings.isConnectionActive(db, userId), false);
  } finally { await cleanup(); }
});

test("disconnect while work is active: a concurrent disconnect is visible to the in-flight transaction's next check (READ COMMITTED)", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockWithingsExchange("acct-1");
    await withings.exchangeCode(config, db, userId, "code");

    let checkedBefore = false, checkedAfter = true;
    await db.transaction(async client => {
      // This models the sync job's own per-record checkpoint: the check
      // runs inside the job's transaction, using the job's own client.
      checkedBefore = await withings.isConnectionActive(clientQueryable(client), userId);
      // A *different* connection (a separate HTTP request calling
      // disconnect while this "sync" is still mid-transaction) removes the
      // row and commits immediately — exactly what controllers/
      // integrations.controller.ts's disconnect handler does.
      await withings.disconnect(db, userId);
      checkedAfter = await withings.isConnectionActive(clientQueryable(client), userId);
    });

    assert.equal(checkedBefore, true);
    assert.equal(checkedAfter, false);
  } finally { await cleanup(); }
});

test("strava: the same concurrent-disconnect visibility holds for isConnectionActive", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockStravaExchange(1);
    await strava.exchangeCode(config, db, userId, "code");

    assert.equal(await strava.isConnectionActive(db, userId), true);
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch; // deauthorize call
    await strava.disconnect(config, db, userId);
    assert.equal(await strava.isConnectionActive(db, userId), false);
  } finally { await cleanup(); }
});

test("late completion after disconnect: a login flow started before disconnect can't complete after it", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await makeUser(db);
    // The user starts a *second* login (e.g. to re-link/refresh scope) —
    // this mints a pending state — then disconnects before ever finishing
    // that flow.
    const state = await createOauthState(db, userId, "withings", "http://localhost:3002/callback");
    await withings.disconnect(db, userId);

    // The stale callback, arriving after disconnect, must fail the same
    // single-use check a genuine replay fails — never silently resurrect
    // the connection.
    const consumed = await consumeOauthState(db, state, "withings");
    assert.equal(consumed, null);
  } finally { await cleanup(); }
});

test("connection cannot be resurrected: disconnect leaves no token row and no usable pending state, even if a connection existed", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockStravaExchange(1);
    await strava.exchangeCode(config, db, userId, "code");
    const staleState = await createOauthState(db, userId, "strava", "http://localhost:3001/api/v1/strava/callback");

    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await strava.disconnect(config, db, userId);

    assert.equal(await strava.loadToken(db, userId), undefined);
    assert.equal(await consumeOauthState(db, staleState, "strava"), null);
  } finally { await cleanup(); }
});

test("existing imported activities and body measurements remain intact after disconnect", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockWithingsExchange("acct-1");
    await withings.exchangeCode(config, db, userId, "code-w");
    mockStravaExchange(1);
    await strava.exchangeCode(config, db, userId, "code-s");

    const activity = await db.get<{ id: number }>(
      "INSERT INTO activities (user_id, filename, activity_date, date_only, source) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [userId, "strava-999.json", "2026-08-01T06:00:00", "2026-08-01", "strava"],
    );
    const body = await db.get<{ id: number }>(
      "INSERT INTO body_measurements (user_id, measured_at, date_only, weight_kg) VALUES ($1,$2,$3,$4) RETURNING id",
      [userId, "2026-08-01T06:30:00", "2026-08-01", 70.1],
    );
    assert.ok(activity && body);

    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await strava.disconnect(config, db, userId);
    await withings.disconnect(db, userId);

    assert.ok(await db.get("SELECT id FROM activities WHERE id=$1", [activity.id]));
    assert.ok(await db.get("SELECT id FROM body_measurements WHERE id=$1", [body.id]));
  } finally { await cleanup(); }
});
