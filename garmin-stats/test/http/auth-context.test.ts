/**
 * test/http/auth-context.test.ts (HRA-348 AC11/AC12; HRA-355 AC5/AC8/AC11)
 * deriveRequestIdentity — the request-identity boundary. Every failure mode
 * collapses to the same 401; a client-supplied user id is never read.
 *
 * The bearer-token tests below are HRA-355's contract test for the native
 * Capacitor client: `identityFromBearerToken` is the same path a native
 * client authenticates through, and it is deliberately client-agnostic (no
 * client-id check), so proving it here — against a local mock OIDC
 * discovery/JWKS server, no network or real Capacitor build required — is
 * the "to the degree current repository tooling permits" contract test the
 * ADR's native-contract section points back to.
 */
import http, { type IncomingMessage } from "http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";
import { loadConfig } from "../../src/config.ts";
import { ApiProblem } from "../../src/http/problem.ts";
import { deriveRequestAccessContext, deriveRequestIdentity, requestIdentity } from "../../src/http/auth-context.ts";
import type { AppContext } from "../../src/http/context.ts";
import { createTestDb } from "../helpers/db.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";

const LIFETIME = { idleSeconds: 1800, absoluteSeconds: 43200 };
const NATIVE_ISSUER = "https://runsfree.eu.auth0.com/";
const NATIVE_AUDIENCE = "https://api.runsfree.example.com";
const NATIVE_KID = "native-test-key-1";

// A minimal local stand-in for Auth0's discovery + JWKS endpoints, so the
// bearer path's real discovery-fetch + remote-JWKS-fetch code runs against a
// trusted key with no network dependency and no Capacitor build required.
async function startMockDiscoveryServer(jwks: JSONWebKeySet): Promise<{ discoveryUrl: string; close: () => Promise<void> }> {
  let baseUrl = "";
  const server = http.createServer((req: IncomingMessage, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jwks_uri: `${baseUrl}/.well-known/jwks.json` }));
      return;
    }
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr == null || typeof addr === "string") throw new Error("failed to bind mock discovery server");
  baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    discoveryUrl: `${baseUrl}/.well-known/openid-configuration`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function nativeKeyPair() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: NATIVE_KID, alg: "RS256", use: "sig" };
  const jwks: JSONWebKeySet = { keys: [publicJwk as JSONWebKeySet["keys"][number]] };
  return { privateKey, jwks };
}

async function signNativeAccessToken(privateKey: Parameters<SignJWT["sign"]>[0], subject: string) {
  return new SignJWT({ iss: NATIVE_ISSUER, aud: NATIVE_AUDIENCE, sub: subject, exp: Math.floor(Date.now() / 1000) + 300 })
    .setProtectedHeader({ alg: "RS256", kid: NATIVE_KID })
    .sign(privateKey);
}

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

test("deriveRequestAccessContext creates founder-public context only for explicitly public read/compute capabilities", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const service = createIdentityService(db, createIdentityRepo(db));
    const ctx = fakeContext(service);
    const readRequest = fakeRequest({ "x-user-id": "client-selected-owner" });

    assert.deepEqual(await deriveRequestAccessContext(readRequest, ctx, "PUBLIC_READ"), {
      kind: "founder-public",
      userId: FOUNDER_USER_ID,
    });
    assert.deepEqual(await deriveRequestAccessContext(fakeRequest({}), ctx, "PUBLIC_COMPUTE"), {
      kind: "founder-public",
      userId: FOUNDER_USER_ID,
    });
    assert.deepEqual(await deriveRequestAccessContext(fakeRequest({}), ctx, "PUBLIC_FEEDBACK"), {
      kind: "public-feedback",
    });
    assert.throws(() => requestIdentity(readRequest), /Authenticated request identity was not established/);
    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({}), ctx, "AUTHENTICATED_READ"));
    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({}), ctx, "AUTHENTICATED_WRITE"));
  } finally { await cleanup(); }
});

test("deriveRequestAccessContext authenticates every supplied credential and never downgrades an invalid or revoked credential to founder-public access", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = createIdentityRepo(db);
    const service = createIdentityService(db, repo);
    const authenticated = await service.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "public-route-runner", provider: "google", email: "runner@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(authenticated.outcome, "authenticated");
    if (authenticated.outcome !== "authenticated") return;
    const cookie = await service.rotateSession(authenticated.user.id, LIFETIME, null);
    const ctx = fakeContext(service);

    const validRequest = fakeRequest({ cookie: `__Host-runsfree_session=${cookie}` });
    assert.deepEqual(await deriveRequestAccessContext(validRequest, ctx, "PUBLIC_READ"), {
      kind: "authenticated",
      identity: requestIdentity(validRequest),
    });
    assert.equal(requestIdentity(validRequest).userId, authenticated.user.id);

    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({ authorization: "not-bearer" }), ctx, "PUBLIC_READ"));
    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({ cookie: "__Host-runsfree_session=unknown" }), ctx, "PUBLIC_COMPUTE"));
    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({ cookie: "__Host-runsfree_session=%" }), ctx, "PUBLIC_READ"));

    await service.revokeSessionByCookie(cookie);
    await assertUnauthorized(deriveRequestAccessContext(fakeRequest({ cookie: `__Host-runsfree_session=${cookie}` }), ctx, "PUBLIC_READ"));
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

test("deriveRequestIdentity authenticates a native-shaped bearer token with no cookie present, resolving the same internal user a web login for the same identity would (HRA-355 AC5)", async () => {
  const { db, cleanup } = await createTestDb();
  const { privateKey, jwks } = await nativeKeyPair();
  const mock = await startMockDiscoveryServer(jwks);
  try {
    const repo = createIdentityRepo(db);
    const service = createIdentityService(db, repo);

    // Simulate the web login this identity already has, exactly like the
    // cookie-path test above — same (issuer, subject), unrelated client.
    const webLogin = await service.resolveExternalLogin(
      { issuer: NATIVE_ISSUER, subject: "auth0|shared-identity", provider: "google", email: "runner@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(webLogin.outcome, "authenticated");
    if (webLogin.outcome !== "authenticated") return;

    const ctx = fakeContext(service, { issuerUrl: NATIVE_ISSUER, discoveryUrl: mock.discoveryUrl, audience: NATIVE_AUDIENCE });
    const token = await signNativeAccessToken(privateKey, "auth0|shared-identity");
    const identity = await deriveRequestIdentity(fakeRequest({ authorization: `Bearer ${token}` }), ctx);

    assert.equal(identity.userId, webLogin.user.id);
    assert.equal(identity.sessionId, null); // bearer auth is stateless on Railway — see the ADR's mobile-logout note
  } finally {
    await mock.close();
    await cleanup();
  }
});

test("deriveRequestAccessContext rejects a trusted-signature bearer token with the wrong issuer instead of downgrading a public route to Guest", async () => {
  const { db, cleanup } = await createTestDb();
  const { privateKey, jwks } = await nativeKeyPair();
  const mock = await startMockDiscoveryServer(jwks);
  try {
    const service = createIdentityService(db, createIdentityRepo(db));
    const ctx = fakeContext(service, { issuerUrl: NATIVE_ISSUER, discoveryUrl: mock.discoveryUrl, audience: NATIVE_AUDIENCE });
    const token = await new SignJWT({
      iss: "https://wrong-issuer.example.com/",
      aud: NATIVE_AUDIENCE,
      sub: "auth0|wrong-issuer",
      exp: Math.floor(Date.now() / 1000) + 300,
    }).setProtectedHeader({ alg: "RS256", kid: NATIVE_KID }).sign(privateKey);

    await assertUnauthorized(deriveRequestAccessContext(
      fakeRequest({ authorization: `Bearer ${token}` }),
      ctx,
      "PUBLIC_READ",
    ));
  } finally {
    await mock.close();
    await cleanup();
  }
});

test("deriveRequestIdentity rejects a native-shaped bearer token for a disabled account with 401, the same as the cookie path (HRA-355 AC8)", async () => {
  const { db, cleanup } = await createTestDb();
  const { privateKey, jwks } = await nativeKeyPair();
  const mock = await startMockDiscoveryServer(jwks);
  try {
    const repo = createIdentityRepo(db);
    const service = createIdentityService(db, repo);
    const login = await service.resolveExternalLogin(
      { issuer: NATIVE_ISSUER, subject: "auth0|disabled-native-user", provider: null, email: null },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(login.outcome, "authenticated");
    if (login.outcome !== "authenticated") return;
    await db.run("UPDATE users SET status = 'disabled' WHERE id = $1", [login.user.id]);

    const ctx = fakeContext(service, { issuerUrl: NATIVE_ISSUER, discoveryUrl: mock.discoveryUrl, audience: NATIVE_AUDIENCE });
    const token = await signNativeAccessToken(privateKey, "auth0|disabled-native-user");
    await assertUnauthorized(deriveRequestIdentity(fakeRequest({ authorization: `Bearer ${token}` }), ctx));
  } finally {
    await mock.close();
    await cleanup();
  }
});
