import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOUNDER_PUBLIC_SLUG, FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { startTestServer, type TestServer } from "../helpers/server.ts";

const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 10km @ RG
`;

async function request(server: TestServer, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", "http://test.invalid");
  const response = await fetch(server.baseUrl + path, { ...init, headers });
  const text = await response.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, headers: response.headers, text, json };
}

async function setPublicationState(server: TestServer, state: "draft" | "published" | "suspended") {
  await server.db.run(
    `INSERT INTO public_projection_sources (id, source_user_id, public_slug, publication_state)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_user_id) DO UPDATE SET publication_state = EXCLUDED.publication_state`,
    [randomUUID(), FOUNDER_USER_ID, FOUNDER_PUBLIC_SLUG, state],
  );
}

async function setUpPlan(server: TestServer) {
  const template = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Founder public plan", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(template.status, 201, JSON.stringify(template.json));
  const templateId = (template.json as { id: number }).id;

  const instance = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Founder agenda", start_date: "2026-09-01", schedule_timezone: "Europe/Rome" }),
  });
  assert.equal(instance.status, 201, JSON.stringify(instance.json));
  const instanceBody = instance.json as { id: number; days: Array<{ id: number; workout_id: string }> };
  const approved = await server.api(`/api/v1/plan-instances/${instanceBody.id}/approve`, { method: "POST" });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  return { templateId, instanceId: instanceBody.id, dayId: instanceBody.days[0]!.id, workoutId: instanceBody.days[0]!.workout_id };
}

test("published founder data flows anonymously through existing activity, range, plan, Agenda and report paths", async () => {
  const server = await startTestServer({ seed: true });
  try {
    await setPublicationState(server, "published");
    const founderActivity = await server.db.get<{ id: number }>("SELECT id FROM activities WHERE user_id=$1 ORDER BY id LIMIT 1", [FOUNDER_USER_ID]);
    assert.ok(founderActivity);
    await server.db.run("UPDATE activities SET activity_type_id=2, activity_name='Founder 5K' WHERE user_id=$1 AND id=$2", [FOUNDER_USER_ID, founderActivity.id]);
    await server.db.run("INSERT INTO date_ranges (user_id,name,from_date,to_date,activity_id) VALUES ($1,$2,$3,$4,$5)", [FOUNDER_USER_ID, "Founder block", "2026-07-01", "2026-09-01", founderActivity.id]);
    const plan = await setUpPlan(server);

    const paths = [
      "/api/v1/range",
      "/api/v1/activities?from=2026-07-01&to=2026-09-30",
      "/api/v1/activities/count?from=2026-07-01&to=2026-09-30",
      `/api/v1/activities/${founderActivity.id}`,
      `/api/v1/activities/${founderActivity.id}/track`,
      "/api/v1/activities/races",
      "/api/v1/summary?from=2026-07-01&to=2026-09-30",
      "/api/v1/weekly?from=2026-07-01&to=2026-09-30",
      "/api/v1/monthly?from=2026-07-01&to=2026-09-30",
      "/api/v1/date-ranges",
      "/api/v1/activity-types",
      "/api/v1/plan-templates",
      `/api/v1/plan-templates/${plan.templateId}`,
      "/api/v1/plan-instances",
      `/api/v1/plan-instances/${plan.instanceId}`,
      "/api/v1/plan-instances/active?date=2026-09-01",
      "/api/v1/plan-instance-days?date=2026-09-01",
      `/api/v1/plan-instances/${plan.instanceId}/reports/workouts/${plan.workoutId}?as_of=2026-09-02T00:00:00.000Z`,
      `/api/v1/plan-instances/${plan.instanceId}/reports/weeks?section_name=Base&week_number=1&as_of=2026-09-02T00:00:00.000Z`,
      `/api/v1/plan-instances/${plan.instanceId}/reports/plan?as_of=2026-09-02T00:00:00.000Z`,
      "/api/v1/reports/range?from=2026-09-01&to=2026-09-07&as_of=2026-09-02T00:00:00.000Z",
    ];

    for (const path of paths) {
      const result = await request(server, path);
      assert.equal(result.status, 200, `${path}: ${result.text}`);
      assert.equal(result.headers.get("cache-control"), "no-store", path);
    }

    const activity = await request(server, `/api/v1/activities/${founderActivity.id}`);
    assert.equal(activity.text.includes(".fit"), false);
    assert.equal(activity.text.includes('"filename"'), false);
    assert.equal(activity.text.includes('"source"'), false);
    assert.equal(activity.text.includes(FOUNDER_USER_ID), false);

    const track = await request(server, `/api/v1/activities/${founderActivity.id}/track`);
    assert.equal(track.text.includes('"lat"'), false);
    assert.equal(track.text.includes('"lon"'), false);
  } finally {
    await server.close();
  }
});

test("approved deterministic compute is anonymous while mutations, billable AI and private reads stay authenticated", async () => {
  const server = await startTestServer();
  try {
    await setPublicationState(server, "published");
    const plan = await setUpPlan(server);
    const publicComputes: Array<[string, unknown]> = [
      ["/api/v1/plan-templates/generate", { dsl_source: DSL }],
      ["/api/v1/plan-templates/prompt-preview", { text: "One week running plan" }],
      [`/api/v1/plan-templates/${plan.templateId}/instantiate/preview`, { start_date: "2026-10-01" }],
      [`/api/v1/plan-instances/${plan.instanceId}/days/${plan.dayId}/validate`, { dsl: "D1: 8km @ RG" }],
    ];
    for (const [path, body] of publicComputes) {
      const result = await request(server, path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(result.status, 200, `${path}: ${result.text}`);
    }

    const privateAttempts: Array<[string, string, unknown?]> = [
      ["GET", "/api/v1/settings"],
      ["GET", "/api/v1/body-measurements"],
      ["GET", "/api/v1/activities/trash"],
      ["GET", "/api/v1/account/profile"],
      ["GET", "/api/v1/garmin/status"],
      ["GET", "/api/v1/withings/status"],
      ["POST", "/api/v1/date-ranges", { name: "blocked", from: "2026-09-01", to: "2026-09-02" }],
      ["PUT", `/api/v1/activities/1/type`, { activity_type_id: 1 }],
      ["POST", `/api/v1/plan-templates/${plan.templateId}/instantiate`, { start_date: "2026-10-01" }],
      ["POST", "/api/v1/plan-templates/ai-generate", { prompt: "billable" }],
      ["POST", "/api/v1/sync/garmin"],
      ["POST", "/api/v1/publication/suspend"],
    ];
    for (const [method, path, body] of privateAttempts) {
      const result = await request(server, path, {
        method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      assert.equal(result.status, 401, `${method} ${path}: ${result.text}`);
    }
  } finally {
    await server.close();
  }
});

test("founder-public routing cannot be redirected to another owner and invalid credentials never downgrade", async () => {
  const server = await startTestServer({ seed: true });
  try {
    await setPublicationState(server, "published");
    const identities = createIdentityService(server.db, createIdentityRepo(server.db));
    const login = await identities.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "other-runner", provider: "google", email: "other@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(login.outcome, "authenticated");
    if (login.outcome !== "authenticated") return;
    const otherId = login.user.id;
    const otherActivity = await server.db.get<{ id: number }>(
      `INSERT INTO activities (user_id,filename,activity_date,date_only,sport,duration_sec,distance_m,source)
       VALUES ($1,'other-private.fit','2026-09-10T07:00:00','2026-09-10','running',1800,5000,'strava') RETURNING id`,
      [otherId],
    );
    assert.ok(otherActivity);

    const founderList = await request(server, `/api/v1/activities?from=2026-07-01&to=2026-09-30&user_id=${otherId}`);
    assert.equal(founderList.status, 200, founderList.text);
    assert.equal(founderList.text.includes("other-private.fit"), false);
    const guessedOther = await request(server, `/api/v1/activities/${otherActivity.id}`);
    assert.equal(guessedOther.status, 404, guessedOther.text);

    const otherCookie = await identities.rotateSession(otherId, { idleSeconds: 1800, absoluteSeconds: 43200 }, null);
    const authenticatedOther = await request(server, "/api/v1/activities?from=2026-07-01&to=2026-09-30", {
      headers: { cookie: `__Host-runsfree_session=${otherCookie}` },
    });
    assert.equal(authenticatedOther.status, 200, authenticatedOther.text);
    assert.equal(authenticatedOther.text.includes("other-private.fit"), true);
    assert.equal(authenticatedOther.text.includes("2026-08-04-10-28-43.fit"), false);

    const missingCsrf = await request(server, "/api/v1/date-ranges", {
      method: "POST",
      headers: { cookie: `__Host-runsfree_session=${otherCookie}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "must not persist", from: "2026-09-01", to: "2026-09-02" }),
    });
    assert.equal(missingCsrf.status, 401, missingCsrf.text);

    const foreignOrigin = await fetch(server.baseUrl + "/api/v1/date-ranges", {
      method: "POST",
      headers: {
        cookie: `__Host-runsfree_session=${otherCookie}`,
        origin: "https://untrusted.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "must not persist", from: "2026-09-01", to: "2026-09-02" }),
    });
    assert.equal(foreignOrigin.status, 403);

    const invalid = await request(server, "/api/v1/activities?from=2026-07-01&to=2026-09-30", {
      headers: { cookie: "__Host-runsfree_session=revoked-or-invalid" },
    });
    assert.equal(invalid.status, 401, invalid.text);
  } finally {
    await server.close();
  }
});

test("live founder reads fail closed when publication is absent, draft or suspended", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const path = "/api/v1/activities?from=2026-07-01&to=2026-09-30";
    assert.equal((await request(server, path)).status, 404);
    await setPublicationState(server, "draft");
    assert.equal((await request(server, path)).status, 404);
    await setPublicationState(server, "published");
    assert.equal((await request(server, path)).status, 200);
    await setPublicationState(server, "suspended");
    const suspended = await request(server, path);
    assert.equal(suspended.status, 404);
    assert.equal((suspended.json as { instance?: string }).instance, "/api/v1/public");
  } finally {
    await server.close();
  }
});

test("OpenAPI marks reviewed public reads/compute anonymous and leaves writes authenticated", () => {
  const spec = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8")) as {
    security: unknown;
    paths: Record<string, Record<string, { security?: unknown }> & { security?: unknown }>;
  };
  const effectiveSecurity = (path: string, method: string) =>
    spec.paths[path]![method]!.security ?? spec.paths[path]!.security ?? spec.security;

  const publicOperations: Array<[string, string]> = [
    ["/api/v1/range", "get"],
    ["/api/v1/activities", "get"],
    ["/api/v1/activities/count", "get"],
    ["/api/v1/activities/races", "get"],
    ["/api/v1/activities/{id}", "get"],
    ["/api/v1/activities/{id}/track", "get"],
    ["/api/v1/summary", "get"],
    ["/api/v1/weekly", "get"],
    ["/api/v1/monthly", "get"],
    ["/api/v1/date-ranges", "get"],
    ["/api/v1/activity-types", "get"],
    ["/api/v1/plan-templates", "get"],
    ["/api/v1/plan-templates/{id}", "get"],
    ["/api/v1/plan-templates/{id}/mobile-eligibility", "get"],
    ["/api/v1/plan-instances", "get"],
    ["/api/v1/plan-instances/active", "get"],
    ["/api/v1/plan-instance-days", "get"],
    ["/api/v1/plan-instances/{id}", "get"],
    ["/api/v1/plan-instances/{id}/reports/workouts/{workoutId}", "get"],
    ["/api/v1/plan-instances/{id}/reports/weeks", "get"],
    ["/api/v1/plan-instances/{id}/reports/plan", "get"],
    ["/api/v1/reports/range", "get"],
    ["/api/v1/plan-templates/generate", "post"],
    ["/api/v1/plan-templates/prompt-preview", "post"],
    ["/api/v1/plan-templates/{id}/instantiate/preview", "post"],
    ["/api/v1/plan-instances/{id}/days/{dayId}/validate", "post"],
  ];
  for (const [path, method] of publicOperations) assert.deepEqual(effectiveSecurity(path, method), [], `${method.toUpperCase()} ${path}`);

  const authenticatedWrites: Array<[string, string]> = [
    ["/api/v1/activities", "delete"],
    ["/api/v1/date-ranges", "post"],
    ["/api/v1/plan-templates", "post"],
    ["/api/v1/plan-templates/ai-generate", "post"],
    ["/api/v1/plan-instances/{id}", "patch"],
    ["/api/v1/publication/suspend", "post"],
  ];
  for (const [path, method] of authenticatedWrites) {
    assert.deepEqual(effectiveSecurity(path, method), [{ runsFreeSession: [] }], `${method.toUpperCase()} ${path}`);
  }
});
