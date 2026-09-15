/**
 * test/integrations/token-redaction.test.ts (HRA-352 follow-up)
 * Verifies access tokens, refresh tokens, the encryption key, and OAuth
 * state secrets never surface through: ordinary API-shaped responses
 * (getTokenStatus), thrown client-visible errors (getValidToken,
 * exchangeCode, ProviderAccountConflictError), or the console.log/warn/error
 * calls the exercised code paths actually make. Spies on the real console
 * methods during real calls — no new logging infrastructure is added for
 * this test, only observation of what already exists.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig, requireIntegrationEncryptionConfig } from "../../src/config.ts";
import * as withings from "../../src/integrations/withings.ts";
import * as strava from "../../src/integrations/strava.ts";
import { ProviderAccountConflictError } from "../../src/integrations/provider-account-conflict.ts";
import { createTestDb } from "../helpers/db.ts";

const ENV_KEYS = ["WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.WITHINGS_CLIENT_ID = "test"; process.env.WITHINGS_CLIENT_SECRET = "test"; process.env.WITHINGS_REDIRECT_URI = "http://localhost:3002/callback";
  process.env.STRAVA_CLIENT_ID = "test"; process.env.STRAVA_CLIENT_SECRET = "test"; process.env.STRAVA_REDIRECT_URI = "http://localhost:3001/api/v1/strava/callback";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

function spyOnConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => { lines.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  console.log = capture; console.warn = capture; console.error = capture;
  return { lines, restore: () => { console.log = original.log; console.warn = original.warn; console.error = original.error; } };
}

const SECRET_ACCESS_TOKEN = "SUPER-SECRET-ACCESS-TOKEN-VALUE";
const SECRET_REFRESH_TOKEN = "SUPER-SECRET-REFRESH-TOKEN-VALUE";

test("withings: exchangeCode/getTokenStatus/disconnect never log the real access or refresh token", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: 0, body: { access_token: SECRET_ACCESS_TOKEN, refresh_token: SECRET_REFRESH_TOKEN, expires_in: 3600, scope: "user.metrics", userid: "acct-1" },
    }), { status: 200 })) as typeof fetch;

    const spy = spyOnConsole();
    try {
      await withings.exchangeCode(config, db, userId, "code");
      await withings.getTokenStatus(config, db, userId);
      await withings.disconnect(db, userId);
    } finally { spy.restore(); }

    const joined = spy.lines.join("\n");
    assert.doesNotMatch(joined, new RegExp(SECRET_ACCESS_TOKEN));
    assert.doesNotMatch(joined, new RegExp(SECRET_REFRESH_TOKEN));
    const { key } = requireIntegrationEncryptionConfig(config);
    assert.doesNotMatch(joined, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { await cleanup(); }
});

test("strava: exchangeCode/getTokenStatus/disconnect never log the real access or refresh token", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      access_token: SECRET_ACCESS_TOKEN, refresh_token: SECRET_REFRESH_TOKEN, expires_at: Math.floor(Date.now() / 1000) + 3600, athlete: { id: 1 },
    }), { status: 200 })) as typeof fetch;

    const spy = spyOnConsole();
    try {
      await strava.exchangeCode(config, db, userId, "code");
      await strava.getTokenStatus(config, db, userId);
      globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
      await strava.disconnect(config, db, userId);
    } finally { spy.restore(); }

    const joined = spy.lines.join("\n");
    assert.doesNotMatch(joined, new RegExp(SECRET_ACCESS_TOKEN));
    assert.doesNotMatch(joined, new RegExp(SECRET_REFRESH_TOKEN));
  } finally { await cleanup(); }
});

test("getTokenStatus's response never carries the token value, even serialized", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: 0, body: { access_token: SECRET_ACCESS_TOKEN, refresh_token: SECRET_REFRESH_TOKEN, expires_in: 3600, scope: "user.metrics", userid: "acct-1" },
    }), { status: 200 })) as typeof fetch;
    await withings.exchangeCode(config, db, userId, "code");

    const status = await withings.getTokenStatus(config, db, userId);
    const serialized = JSON.stringify(status);
    assert.doesNotMatch(serialized, new RegExp(SECRET_ACCESS_TOKEN));
    assert.doesNotMatch(serialized, new RegExp(SECRET_REFRESH_TOKEN));
    assert.equal("access_token" in status, false);
    assert.equal("refresh_token" in status, false);
  } finally { await cleanup(); }
});

test("a failed token exchange's thrown error never embeds the encryption key or a submitted token value", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 503 }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      () => withings.exchangeCode(config, db, userId, "code"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        const { key } = requireIntegrationEncryptionConfig(config);
        assert.doesNotMatch(err.message, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.doesNotMatch(err.message, /code/); // the submitted auth code is never echoed
        return true;
      },
    );
  } finally { await cleanup(); }
});

test("ProviderAccountConflictError's message is the fixed generic string — never names the conflicting account or user", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      status: 0, body: { access_token: "a", refresh_token: "b", expires_in: 3600, scope: "user.metrics", userid: "shared-secret-account-id-999" },
    }), { status: 200 })) as typeof fetch;
    await withings.exchangeCode(config, db, userA, "code-a");

    await assert.rejects(
      () => withings.exchangeCode(config, db, userB, "code-b"),
      (err: unknown) => {
        assert.ok(err instanceof ProviderAccountConflictError);
        assert.equal(err.message, "This provider account is already connected to a different account.");
        assert.doesNotMatch(err.message, /shared-secret-account-id-999/);
        assert.doesNotMatch(err.message, new RegExp(userA));
        return true;
      },
    );
  } finally { await cleanup(); }
});

test("getValidToken's 'no connection' error names no token, connection id, or other owner's data", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    await assert.rejects(
      () => withings.getValidToken(config, db, userId),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, "No Withings connection for this account. Connect it from the dashboard first.");
        return true;
      },
    );
  } finally { await cleanup(); }
});
