import assert from "node:assert/strict";
import { test } from "node:test";
import { FOUNDER_PUBLIC_SLUG, FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { startTestServer } from "../helpers/server.ts";

async function authHeadersFor(server: Awaited<ReturnType<typeof startTestServer>>, userId: string): Promise<Headers> {
  const identities = createIdentityService(server.db, createIdentityRepo(server.db));
  const cookie = await identities.rotateSession(userId, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
  const headers = new Headers({ cookie: `__Host-runsfree_session=${cookie}`, origin: "http://test.invalid" });
  const { createHmac } = await import("node:crypto");
  headers.set("x-runsfree-csrf", createHmac("sha256", "runsfree-session-csrf-v1").update(cookie).digest("base64url"));
  return headers;
}

test("founder previews, publishes, refreshes idempotently, and suspends over the real authenticated API", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const before = await server.api("/api/v1/publication");
    assert.equal(before.status, 200);
    assert.deepEqual(before.json, { state: "unconfigured", publicUrl: null, projectedAt: null, lastError: null, canRetry: false });

    const preview = await server.api("/api/v1/publication/preview");
    assert.equal(preview.status, 200);
    const previewBody = preview.json as { state: string; publicUrl: string; snapshot: { slug: string; profile: { fields: Record<string, unknown> } | null; activities: { fields: Record<string, unknown> }[] } };
    assert.equal(previewBody.state, "draft");
    assert.equal(previewBody.publicUrl, `/p/${FOUNDER_PUBLIC_SLUG}`);
    assert.equal(previewBody.snapshot.slug, FOUNDER_PUBLIC_SLUG);
    assert.equal(previewBody.snapshot.activities.length, 2);
    // seedSampleData never sets display_name/locale/unit_system — the profile
    // resource still projects (present, allowlisted, all fields absent/null),
    // never crashing the gather step over a founder with no profile filled in.
    assert.ok(previewBody.snapshot.profile);

    const publish = await server.api("/api/v1/publication/publish", { method: "POST" });
    assert.equal(publish.status, 200);
    const publishedStatus = publish.json as { state: string; publicUrl: string; projectedAt: string };
    assert.equal(publishedStatus.state, "published");
    assert.ok(publishedStatus.projectedAt);

    const guestRead = await fetch(`${server.baseUrl}/api/v1/public/profiles/${FOUNDER_PUBLIC_SLUG}/activities`, { headers: { origin: "http://test.invalid" } });
    assert.equal(guestRead.status, 200);
    const guestActivities = (await guestRead.json()) as { data: unknown[] };
    assert.equal(guestActivities.data.length, 2);

    // Refresh with unchanged underlying data is idempotent — same projectedAt,
    // no duplicated public resources — and returns the same safe status shape
    // every other publication route returns (never the raw sourceId/hash).
    const refreshUnchanged = await server.api("/api/v1/publication/refresh", { method: "POST" });
    assert.equal(refreshUnchanged.status, 200);
    const refreshedStatus = refreshUnchanged.json as { state: string; projectedAt: string };
    assert.equal(refreshedStatus.projectedAt, publishedStatus.projectedAt);
    assert.equal(Object.keys(refreshedStatus).sort().join(","), "canRetry,lastError,projectedAt,publicUrl,state");

    // A real underlying change (a new activity) changes the content hash, so a
    // refresh after it is NOT a no-op — projectedAt advances.
    await server.db.run(
      "INSERT INTO activities (user_id,filename,activity_date,date_only,sport,duration_sec,distance_m,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [FOUNDER_USER_ID, "new-run.fit", "2026-09-16T07:00:00", "2026-09-16", "running", 1800, 5000, "garmin"],
    );
    const refreshChanged = await server.api("/api/v1/publication/refresh", { method: "POST" });
    assert.equal(refreshChanged.status, 200);
    assert.notEqual((refreshChanged.json as { projectedAt: string }).projectedAt, publishedStatus.projectedAt);

    const suspend = await server.api("/api/v1/publication/suspend", { method: "POST" });
    assert.equal(suspend.status, 200);
    assert.equal((suspend.json as { state: string }).state, "suspended");

    const guestAfterSuspend = await fetch(`${server.baseUrl}/api/v1/public/profiles/${FOUNDER_PUBLIC_SLUG}`, { headers: { origin: "http://test.invalid" } });
    assert.equal(guestAfterSuspend.status, 404);
  } finally { await server.close(); }
});

test("an ordinary authenticated user gets the same forbidden response from every publication route, never a disclosure", async () => {
  const server = await startTestServer();
  try {
    const identities = createIdentityService(server.db, createIdentityRepo(server.db));
    const other = await identities.resolveExternalLogin(
      { issuer: "https://idp.example", subject: "not-the-founder", provider: "test", email: "other@example.test" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(other.outcome, "authenticated");
    if (other.outcome !== "authenticated") return;
    const headers = await authHeadersFor(server, other.user.id);

    for (const [path, method] of [
      ["/api/v1/publication", "GET"],
      ["/api/v1/publication/preview", "GET"],
      ["/api/v1/publication/publish", "POST"],
      ["/api/v1/publication/refresh", "POST"],
      ["/api/v1/publication/suspend", "POST"],
    ] as const) {
      const res = await fetch(server.baseUrl + path, { method, headers });
      assert.equal(res.status, 403, `${method} ${path} should 403 for a non-founder`);
      const body = await res.json() as { detail?: string };
      assert.equal(body.detail, undefined); // generic — never names which check failed
    }
  } finally { await server.close(); }
});

test("preview never mutates publication_state, and a failed refresh's failure/retry state is still readable through status()", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const preview1 = await server.api("/api/v1/publication/preview");
    assert.equal(preview1.status, 200);
    const statusAfterPreview = await server.api("/api/v1/publication");
    // Preview refreshes the underlying snapshot (HRA-360 semantics: preview
    // calls refresh internally, which creates the source row) but never
    // itself calls setPublicationState — "draft", never "published", until an
    // explicit publish.
    assert.equal((statusAfterPreview.json as { state: string }).state, "draft");

    await server.api("/api/v1/publication/publish", { method: "POST" });
    // Force a non-finite value into a projected activity field so the next
    // refresh's own JSON-safety check trips (same failure the service-level
    // publication-lifecycle.service.test.ts exercises directly) — this test
    // only verifies the HTTP wiring propagates that failure honestly rather
    // than silently claiming success, not the failure mechanics themselves.
    await server.db.run("UPDATE activities SET distance_m = 'NaN'::float8");
    const failedRefresh = await server.api("/api/v1/publication/refresh", { method: "POST" });
    assert.equal(failedRefresh.status, 500); // no fabricated 200 for a mutation that didn't happen
    assert.equal(failedRefresh.text.includes("NaN"), false);

    const statusAfterFailure = await server.api("/api/v1/publication");
    const failedStatus = statusAfterFailure.json as { lastError: string | null; canRetry: boolean };
    assert.equal(failedStatus.lastError, "projection_refresh_failed");
    assert.equal(failedStatus.canRetry, true);

    await server.db.run("UPDATE activities SET distance_m = 5000");
    const recovered = await server.api("/api/v1/publication/refresh", { method: "POST" });
    assert.equal(recovered.status, 200);
    assert.equal((recovered.json as { lastError: string | null }).lastError, null);
  } finally { await server.close(); }
});
