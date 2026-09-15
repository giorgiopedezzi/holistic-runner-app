import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startTestServer } from "../helpers/server.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";

function authHeaders(cookie: string): Headers {
  const headers = new Headers({ cookie: `__Host-runsfree_session=${cookie}`, origin: "http://test.invalid" });
  headers.set("x-runsfree-csrf", createHmac("sha256", "runsfree-session-csrf-v1").update(cookie).digest("base64url"));
  return headers;
}

test("account export is owner-scoped, versioned, redacted, and unavailable to another authenticated user", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const created = await server.api("/api/v1/account/exports", { method: "POST" });
    assert.equal(created.status, 201);
    const download = (created.json as { download_url: string }).download_url;
    assert.match(download, /^\/api\/v1\/account\/exports\/[0-9a-f-]+\?token=/);

    const exported = await server.api(download);
    assert.equal(exported.status, 200);
    const payload = exported.json as { manifest: { version: number; excluded: string[]; unavailable: string[] }; data: { activities: unknown[] } };
    assert.equal(payload.manifest.version, 1);
    assert.ok(payload.manifest.excluded.includes("integration_credentials"));
    assert.ok(payload.manifest.unavailable.includes("original_uploaded_fit_files"));
    assert.ok(payload.data.activities.length > 0);
    assert.equal(JSON.stringify(payload).includes("access_token"), false);

    const identities = createIdentityService(server.db, createIdentityRepo(server.db));
    const other = await identities.resolveExternalLogin({ issuer: "https://idp.example", subject: "other", provider: "test", email: "other@example.test" }, { mode: "open", founderAllowlist: [] });
    assert.equal(other.outcome, "authenticated");
    if (other.outcome !== "authenticated") return;
    const otherCookie = await identities.rotateSession(other.user.id, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
    const crossUser = await fetch(server.baseUrl + download, { headers: authHeaders(otherCookie) });
    assert.equal(crossUser.status, 404);

    await server.db.run("UPDATE account_exports SET expires_at = now() - interval '1 second'");
    assert.equal((await server.api(download)).status, 404);
  } finally { await server.close(); }
});

test("recent authentication is required for other-session revocation and accepted deletion disables access and credentials", async () => {
  const server = await startTestServer();
  try {
    const identities = createIdentityService(server.db, createIdentityRepo(server.db));
    const recent = await identities.rotateSession(FOUNDER_USER_ID, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
    const other = await identities.rotateSession(FOUNDER_USER_ID, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
    const revoke = await fetch(server.baseUrl + "/api/v1/account/sessions/revoke-others", { method: "POST", headers: authHeaders(recent) });
    assert.equal(revoke.status, 200);
    assert.equal(await identities.validateSessionCookie(other, 1800), null);

    await server.db.run("INSERT INTO withings_tokens (user_id, access_token, refresh_token, expires_at) VALUES ($1, $2, $3, $4)", [FOUNDER_USER_ID, "encrypted", "encrypted", 1]);
    const deletion = await fetch(server.baseUrl + "/api/v1/account/deletion-request", { method: "POST", headers: authHeaders(recent), body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }) });
    assert.equal(deletion.status, 202);
    const firstRequest = await deletion.json() as { id: string };
    const { createAccountPrivacyRepo } = await import("../../src/repositories/account-privacy.repo.ts");
    const { createAccountPrivacyService } = await import("../../src/services/account-privacy.service.ts");
    const duplicate = await createAccountPrivacyService(server.db, createAccountPrivacyRepo(server.db), createIdentityRepo(server.db)).requestDeletion(FOUNDER_USER_ID);
    assert.equal(duplicate.id, firstRequest.id);
    assert.equal((await server.db.get<{ status: string }>("SELECT status FROM users WHERE id = $1", [FOUNDER_USER_ID]))?.status, "deletion_pending");
    assert.equal(await server.db.get("SELECT user_id FROM withings_tokens WHERE user_id = $1", [FOUNDER_USER_ID]), undefined);
    assert.equal((await server.api("/api/v1/auth/session", { headers: { cookie: `__Host-runsfree_session=${recent}` } })).status, 401);
  } finally { await server.close(); }
});

test("the deletion worker purges the owned root atomically after acceptance", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const service = createIdentityService(server.db, createIdentityRepo(server.db));
    const cookie = await service.rotateSession(FOUNDER_USER_ID, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
    const accepted = await fetch(server.baseUrl + "/api/v1/account/deletion-request", { method: "POST", headers: authHeaders(cookie), body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" }) });
    assert.equal(accepted.status, 202);
    const privacy = (await import("../../src/services/account-privacy.service.ts"));
    // Use the server's wired dependencies indirectly through a fresh service:
    // the same root delete is what the production interval invokes.
    const { createAccountPrivacyRepo } = await import("../../src/repositories/account-privacy.repo.ts");
    const worker = privacy.createAccountPrivacyService(server.db, createAccountPrivacyRepo(server.db), createIdentityRepo(server.db));
    // A failed request is retried without changing the account back to active.
    await server.db.run("UPDATE account_deletion_requests SET status = 'failed', last_error = 'simulated failure'");
    await worker.processQueuedDeletions();
    assert.equal(await server.db.get("SELECT id FROM users WHERE id = $1", [FOUNDER_USER_ID]), undefined);
    assert.equal(await server.db.get("SELECT id FROM activities WHERE user_id = $1", [FOUNDER_USER_ID]), undefined);
  } finally { await server.close(); }
});
