import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import type { PublicProjectionSnapshot } from "../../src/domain/publication/public-projection.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

const SLUG = "founder-journey";
const PROFILE_ID = "4e1172b8-8c17-4c62-a221-5891bb06a169";
const ACTIVITY_ID = "84d9d553-d887-46f6-8912-53eb17743dd7";
const PLAN_ID = "c87cd264-8605-40a2-8674-f9b995b45a2e";
const REPORT_ID = "b67df028-934e-4e96-991c-57196f192d58";
const PROJECTED_AT = "2026-09-15T12:30:00.000Z";
const SOURCE_VERSION = "4f8d84b377e96a9a0212c4d5657ab174252d07392b58a8d2672d0325718f16b";

function snapshot(): PublicProjectionSnapshot {
  return {
    schemaVersion: 1,
    slug: SLUG,
    sourceVersion: SOURCE_VERSION,
    projectedAt: PROJECTED_AT,
    profile: { publicId: PROFILE_ID, fields: { displayName: "Founder Runner", locale: "en-GB" } },
    activities: [{ publicId: ACTIVITY_ID, fields: { title: "Sunday long run", date: "2026-09-13", distanceM: 12_345 } }],
    plans: [{ publicId: PLAN_ID, fields: { name: "Boston build", raceDate: "2028-04-17" } }],
    reports: [{ publicId: REPORT_ID, fields: { kind: "plan", coverage: { trustedActivities: 3 } } }],
  };
}

async function publish(s: TestServer, state: "draft" | "published" | "suspended" = "published"): Promise<string> {
  const sourceId = randomUUID();
  await s.db.run(
    "INSERT INTO public_projection_sources (id, source_user_id, public_slug, publication_state) VALUES ($1, $2, $3, $4)",
    [sourceId, FOUNDER_USER_ID, SLUG, state],
  );
  await s.db.run(
    "INSERT INTO public_projection_snapshots (source_id, source_version_hash, payload, projected_at) VALUES ($1, $2, $3::jsonb, $4)",
    [sourceId, SOURCE_VERSION, JSON.stringify(snapshot()), PROJECTED_AT],
  );
  return sourceId;
}

async function anonymousGet(s: TestServer, path: string) {
  const response = await fetch(s.baseUrl + path, { headers: { origin: "http://test.invalid" } });
  const text = await response.text();
  return { response, text, json: text ? JSON.parse(text) as unknown : undefined };
}

test("anonymous public routes expose only the published projection and opaque identifiers", async () => {
  const s = await startTestServer();
  try {
    await publish(s);

    const profile = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}`);
    assert.equal(profile.response.status, 200);
    assert.equal(profile.response.headers.get("cache-control"), "no-store");
    assert.deepEqual(profile.json, {
      slug: SLUG,
      projectedAt: PROJECTED_AT,
      data: { publicId: PROFILE_ID, fields: { displayName: "Founder Runner", locale: "en-GB" } },
    });

    const activities = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/activities`);
    const plans = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/plans`);
    const reports = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/reports`);
    assert.equal(activities.response.status, 200);
    assert.deepEqual((activities.json as { data: unknown[] }).data, snapshot().activities);
    assert.deepEqual((plans.json as { data: unknown[] }).data, snapshot().plans);
    assert.deepEqual((reports.json as { data: unknown[] }).data, snapshot().reports);

    const activity = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/activities/${ACTIVITY_ID}`);
    const plan = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/plans/${PLAN_ID}`);
    const report = await anonymousGet(s, `/api/v1/public/profiles/${SLUG}/reports/${REPORT_ID}`);
    assert.deepEqual((activity.json as { data: unknown }).data, snapshot().activities[0]);
    assert.deepEqual((plan.json as { data: unknown }).data, snapshot().plans[0]);
    assert.deepEqual((report.json as { data: unknown }).data, snapshot().reports[0]);

    const serialized = [profile.text, activities.text, plans.text, reports.text, activity.text, plan.text, report.text].join("\n");
    for (const privateValue of [FOUNDER_USER_ID, "private@example.com", "secret.fit", "auth0|founder", "access_token"]) {
      assert.equal(serialized.includes(privateValue), false, `public response leaked ${privateValue}`);
    }

    const contract = (await anonymousGet(s, "/api/v1/openapi.json")).json as { paths: Record<string, unknown> };
    for (const path of [
      "/api/v1/public/profiles/{slug}",
      "/api/v1/public/profiles/{slug}/activities", "/api/v1/public/profiles/{slug}/activities/{publicId}",
      "/api/v1/public/profiles/{slug}/plans", "/api/v1/public/profiles/{slug}/plans/{publicId}",
      "/api/v1/public/profiles/{slug}/reports", "/api/v1/public/profiles/{slug}/reports/{publicId}",
    ]) assert.ok(contract.paths[path], `OpenAPI is missing ${path}`);
  } finally {
    await s.close();
  }
});

test("approved live founder reads are anonymous while private reads and guessed public identifiers stay protected", async () => {
  const s = await startTestServer({ seed: true });
  try {
    await publish(s);
    const founderActivity = await anonymousGet(s, "/api/v1/activities/1");
    assert.equal(founderActivity.response.status, 200);
    assert.equal(founderActivity.response.headers.get("cache-control"), "no-store");
    assert.equal(founderActivity.text.includes("filename"), false);
    assert.equal(founderActivity.text.includes(FOUNDER_USER_ID), false);

    const privateRead = await anonymousGet(s, "/api/v1/body-measurements");
    assert.equal(privateRead.response.status, 401);

    const guesses = [
      `/api/v1/public/profiles/${FOUNDER_USER_ID}`,
      `/api/v1/public/profiles/${SLUG}/activities/1`,
      `/api/v1/public/profiles/${SLUG}/activities/${randomUUID()}`,
    ];
    for (const path of guesses) {
      const result = await anonymousGet(s, path);
      assert.equal(result.response.status, 404);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.deepEqual(result.json, {
        type: "about:blank", title: "Not Found", status: 404,
        detail: "Public resource is unavailable.", instance: "/api/v1/public",
      });
      assert.equal(result.text.includes(FOUNDER_USER_ID), false);
      assert.equal(result.text.includes("activities/1"), false);
    }

    const unsupported = await fetch(`${s.baseUrl}/api/v1/public/profiles/${FOUNDER_USER_ID}/private-owner-data`, {
      method: "POST", headers: { origin: "http://test.invalid" },
    });
    const unsupportedText = await unsupported.text();
    assert.equal(unsupported.status, 404);
    assert.equal(unsupported.headers.get("cache-control"), "no-store");
    assert.equal(unsupportedText.includes(FOUNDER_USER_ID), false);
    assert.deepEqual(JSON.parse(unsupportedText), {
      type: "about:blank", title: "Not Found", status: 404,
      detail: "Public resource is unavailable.", instance: "/api/v1/public",
    });
  } finally {
    await s.close();
  }
});

test("draft, suspended, and stale projections all fail closed as unavailable", async () => {
  const s = await startTestServer();
  try {
    const sourceId = await publish(s, "draft");
    const path = `/api/v1/public/profiles/${SLUG}/activities`;
    assert.equal((await anonymousGet(s, path)).response.status, 404);

    await s.db.run("UPDATE public_projection_sources SET publication_state = 'published' WHERE id = $1", [sourceId]);
    assert.equal((await anonymousGet(s, path)).response.status, 200);

    await s.db.run("UPDATE public_projection_sources SET publication_state = 'suspended' WHERE id = $1", [sourceId]);
    assert.equal((await anonymousGet(s, path)).response.status, 404);

    await s.db.run("UPDATE public_projection_sources SET publication_state = 'published' WHERE id = $1", [sourceId]);
    await s.db.run(
      "UPDATE public_projection_snapshots SET payload = jsonb_set(payload, '{schemaVersion}', '0'::jsonb) WHERE source_id = $1",
      [sourceId],
    );
    const stale = await anonymousGet(s, path);
    assert.equal(stale.response.status, 404);
    assert.equal(stale.text.includes("schemaVersion"), false);
    assert.equal(stale.text.includes(SOURCE_VERSION), false);
  } finally {
    await s.close();
  }
});

test("unexpected public failures keep guessed identifiers and infrastructure details out of responses and logs", async () => {
  const s = await startTestServer();
  const guessedPrivateId = FOUNDER_USER_ID;
  const logged: string[] = [];
  const originalLog = console.log;
  try {
    await s.db.run("DROP VIEW published_public_projections");
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
    const result = await anonymousGet(s, `/api/v1/public/profiles/${guessedPrivateId}`);
    assert.equal(result.response.status, 500);
    assert.equal(result.text.includes(guessedPrivateId), false);
    assert.equal(result.text.includes("published_public_projections"), false);
    assert.equal(logged.length, 1);
    assert.match(logged[0]!, /public_read_failed/);
    assert.equal(logged[0]!.includes(guessedPrivateId), false);
    assert.equal(logged[0]!.includes("published_public_projections"), false);
  } finally {
    console.log = originalLog;
    await s.close();
  }
});
