/**
 * test/http/auth-context.test.ts (HRA-348 AC11/AC12)
 * deriveRequestIdentity — the request-identity boundary. Every failure mode
 * collapses to the same 401; a client-supplied user id is never read.
 */
import type http from "http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.ts";
import { ApiProblem } from "../../src/http/problem.ts";
import { deriveRequestIdentity } from "../../src/http/auth-context.ts";
import type { AppContext } from "../../src/http/context.ts";
import { createTestDb } from "../helpers/db.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";

const LIFETIME = { idleSeconds: 1800, absoluteSeconds: 43200 };

function fakeRequest(headers: Record<string, string | undefined>): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

function fakeContext(identityService: ReturnType<typeof createIdentityService>, authOverrides: Partial<AppContext["config"]["auth"]> = {}): AppContext {
  const config = loadConfig();
  return {
    port: 0, scriptsDir: "", backgroundsDir: "",
    config: { ...config, auth: { ...config.auth, enabled: true, ...authOverrides } },
    db: undefined as never,
    repos: undefined as never,
    services: { identity: identityService } as unknown as AppContext["services"],
  } as unknown as AppContext;
}

async function assertUnauthorized(promise: Promise<unknown>) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiProblem);
    assert.equal(error.problem.status, 401);
    return true;
  });
}

test("deriveRequestIdentity rejects with 401 when AUTH_ENABLED is false, even with a would-be-valid cookie present", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const service = createIdentityService(db, createIdentityRepo(db));
    const ctx = fakeContext(service, { enabled: false });
    await assertUnauthorized(deriveRequestIdentity(fakeRequest({ cookie: "__Host-runsfree_session=whatever" }), ctx));
  } finally { await cleanup(); }
});

test("deriveRequestIdentity rejects with 401 when no session cookie or Authorization header is present", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const service = createIdentityService(db, createIdentityRepo(db));
    const ctx = fakeContext(service);
    await assertUnauthorized(deriveRequestIdentity(fakeRequest({}), ctx));
  } finally { await cleanup(); }
});

test("deriveRequestIdentity rejects with 401 for a malformed/unknown session cookie", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const service = createIdentityService(db, createIdentityRepo(db));
    const ctx = fakeContext(service);
    await assertUnauthorized(deriveRequestIdentity(fakeRequest({ cookie: "__Host-runsfree_session=not-a-real-session" }), ctx));
  } finally { await cleanup(); }
});

test("deriveRequestIdentity resolves the real session owner from a valid cookie and ignores a forged client-supplied user id header entirely", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = createIdentityRepo(db);
    const service = createIdentityService(db, repo);
    const authenticated = await service.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "real-owner", provider: "google", email: "owner@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;
    const cookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);

    const ctx = fakeContext(service);
    // A forged header naming a different user id must have zero effect —
    // deriveRequestIdentity only ever reads the cookie/Authorization header.
    const identity = await deriveRequestIdentity(
      fakeRequest({ cookie: `__Host-runsfree_session=${cookie}`, "x-user-id": "someone-elses-id" }),
      ctx,
    );
    assert.equal(identity.userId, authenticated.user.id);
    assert.notEqual(identity.userId, "someone-elses-id");
  } finally { await cleanup(); }
});

test("deriveRequestIdentity rejects with 401 once the session's account becomes disabled", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = createIdentityRepo(db);
    const service = createIdentityService(db, repo);
    const authenticated = await service.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "sub-1", provider: "google", email: "a@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;
    const cookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);
    await db.run("UPDATE users SET status = 'disabled' WHERE id = $1", [authenticated.user.id]);

    const ctx = fakeContext(service);
    await assertUnauthorized(deriveRequestIdentity(fakeRequest({ cookie: `__Host-runsfree_session=${cookie}` }), ctx));
  } finally { await cleanup(); }
});
