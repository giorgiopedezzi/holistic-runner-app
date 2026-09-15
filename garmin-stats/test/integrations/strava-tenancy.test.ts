/**
 * test/integrations/strava-tenancy.test.ts (HRA-352 AC1/AC2/AC5)
 * Mirrors withings-tenancy.test.ts for integrations/strava.ts, plus the
 * Strava-specific behaviors: the provider account id only arrives on the
 * authorization_code exchange (never on a refresh) and must survive a
 * refresh unchanged, and disconnect best-effort-revokes remotely before
 * removing the local row.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../src/config.ts";
import { exchangeCode, loadToken, disconnect, getTokenStatus } from "../../src/integrations/strava.ts";
import { ProviderAccountConflictError } from "../../src/integrations/provider-account-conflict.ts";
import { createTestDb } from "../helpers/db.ts";

const ENV_KEYS = ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.STRAVA_CLIENT_ID = "test-client";
  process.env.STRAVA_CLIENT_SECRET = "test-secret";
  process.env.STRAVA_REDIRECT_URI = "http://localhost:3001/api/v1/strava/callback";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});

function mockAuthorizationExchange(athleteId: number, accessToken = "access-1") {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    access_token: accessToken, refresh_token: "refresh-1", expires_at: Math.floor(Date.now() / 1000) + 3600,
    athlete: { id: athleteId },
  }), { status: 200 })) as typeof fetch;
}

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

test("each owner's token is stored and read back independently — no cross-owner visibility", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);

    mockAuthorizationExchange(111, "access-a");
    await exchangeCode(config, db, userA, "code-a");
    mockAuthorizationExchange(222, "access-b");
    await exchangeCode(config, db, userB, "code-b");

    const tokenA = await loadToken(db, userA);
    const tokenB = await loadToken(db, userB);
    assert.equal(tokenA?.provider_account_id, "111");
    assert.equal(tokenB?.provider_account_id, "222");
    assert.notEqual(tokenA?.access_token, tokenB?.access_token);
  } finally { await cleanup(); }
});

test("a provider account already linked to a different owner is rejected, not silently reassigned or duplicated", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);

    mockAuthorizationExchange(999);
    await exchangeCode(config, db, userA, "code-a");
    mockAuthorizationExchange(999);
    await assert.rejects(() => exchangeCode(config, db, userB, "code-b"), ProviderAccountConflictError);

    assert.equal((await loadToken(db, userA))?.provider_account_id, "999");
    assert.equal(await loadToken(db, userB), undefined);
  } finally { await cleanup(); }
});

test("access/refresh tokens are stored encrypted, not as plaintext", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockAuthorizationExchange(1, "the-real-strava-access-token");
    await exchangeCode(config, db, userId, "code");

    const raw = await db.get<{ access_token: string }>("SELECT access_token FROM strava_tokens WHERE user_id = $1", [userId]);
    assert.ok(raw);
    assert.notEqual(raw.access_token, "the-real-strava-access-token");
  } finally { await cleanup(); }
});

test("a two-user adversarial check: owner B's status/scope is never derived from owner A's connection", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    mockAuthorizationExchange(111, "access-a");
    await exchangeCode(config, db, userA, "code-a");
    // userB never connects.

    const statusA = await getTokenStatus(config, db, userA);
    const statusB = await getTokenStatus(config, db, userB);
    assert.equal(statusA.present, true);
    assert.equal(statusA.scope, "activity:read_all");
    assert.deepEqual(statusB, { present: false, valid: false });
    assert.equal("scope" in statusB, false);
  } finally { await cleanup(); }
});

test("disconnect best-effort revokes remotely, then always removes the local row for that owner only", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    mockAuthorizationExchange(1);
    await exchangeCode(config, db, userA, "code-a");
    mockAuthorizationExchange(2);
    await exchangeCode(config, db, userB, "code-b");

    let deauthorizeCalled = false;
    globalThis.fetch = (async (input: unknown) => {
      if (typeof input === "string" && input.includes("deauthorize")) { deauthorizeCalled = true; return new Response("{}", { status: 200 }); }
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    const removed = await disconnect(config, db, userA);
    assert.equal(removed, true);
    assert.equal(deauthorizeCalled, true);
    assert.equal(await loadToken(db, userA), undefined);
    assert.ok(await loadToken(db, userB));
  } finally { await cleanup(); }
});

test("disconnect still removes the local row even when the remote revoke call fails", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockAuthorizationExchange(1);
    await exchangeCode(config, db, userId, "code");

    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;

    const removed = await disconnect(config, db, userId);
    assert.equal(removed, true);
    assert.equal(await loadToken(db, userId), undefined);
  } finally { await cleanup(); }
});
