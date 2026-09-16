import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { startTestServer } from "../helpers/server.ts";

const SESSION = { idleSeconds: 1800, absoluteSeconds: 43200 };
const PLAN_DSL = `PACE RG=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`;

test("a second authenticated owner cannot list, read, track, or aggregate the founder's private activity and body data", async () => {
  const server = await startTestServer();
  try {
    const seeded = await server.seed();
    const templateResponse = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Founder private template", event: "marathon", dsl_source: PLAN_DSL }),
    });
    assert.equal(templateResponse.status, 201, JSON.stringify(templateResponse.json));
    const templateId = (templateResponse.json as { id: number }).id;
    const instanceResponse = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Founder private instance", start_date: "2030-01-01", goal_time: "03:30:00", race_pace_anchor: "RG" }),
    });
    assert.equal(instanceResponse.status, 201, JSON.stringify(instanceResponse.json));
    const instanceId = (instanceResponse.json as { id: number }).id;
    const anonymous = await server.api("/api/v1/activities?from=2026-07-01&to=2026-09-01", { headers: { cookie: "" } });
    assert.equal(anonymous.status, 404);
    assert.deepEqual(anonymous.json, {
      type: "about:blank", title: "Not Found", status: 404,
      detail: "Public resource is unavailable.", instance: "/api/v1/public",
    });

    const identity = createIdentityService(server.db, createIdentityRepo(server.db));
    const login = await identity.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "tenant-b", provider: "test", email: "tenant-b@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(login.outcome, "authenticated");
    if (login.outcome !== "authenticated") return;
    const cookie = await identity.rotateSession(login.user.id, SESSION, null);
    const headers = { cookie: `__Host-runsfree_session=${cookie}` };

    const bodyInsert = await server.db.get<{ id: number }>(
      "INSERT INTO body_measurements (user_id,measured_at,date_only,weight_kg) VALUES ($1,$2,$3,$4) RETURNING id",
      [login.user.id, "2026-08-02T06:30:00", "2026-08-02", 66.2],
    );
    assert.ok(bodyInsert);

    const list = await server.api("/api/v1/activities?from=2026-07-01&to=2026-09-01", { headers });
    assert.equal(list.status, 200);
    assert.deepEqual((list.json as { data: unknown[] }).data, []);

    for (const path of [
      `/api/v1/activities/${seeded.activityIds[0]}`,
      `/api/v1/activities/${seeded.activityIds[0]}/track`,
      `/api/v1/activities/${seeded.activityIds[0]}/association`,
    ]) {
      const response = await server.api(path, { headers });
      assert.equal(response.status, 404, path);
    }

    const summary = await server.api("/api/v1/summary?from=2026-07-01&to=2026-09-01", { headers });
    assert.deepEqual((summary.json as { data: unknown[] }).data, []);

    const body = await server.api("/api/v1/body-measurements?from=2026-07-01&to=2026-09-01", { headers });
    assert.equal(body.status, 200);
    assert.equal((body.json as { data: { weight_kg: number }[] }).data[0]?.weight_kg, 66.2);

    for (const path of [
      `/api/v1/plan-templates/${templateId}`,
      `/api/v1/plan-instances/${instanceId}`,
      `/api/v1/plan-instances/${instanceId}/reports/plan`,
    ]) {
      const response = await server.api(path, { headers });
      assert.equal(response.status, 404, path);
    }
    const planList = await server.api("/api/v1/plan-templates", { headers });
    assert.deepEqual((planList.json as { data: unknown[] }).data, []);
    const crossOwnerUpdate = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ name: "forbidden" }),
    });
    assert.equal(crossOwnerUpdate.status, 404);
    const founderInstance = await server.api(`/api/v1/plan-instances/${instanceId}`);
    assert.equal((founderInstance.json as { name: string }).name, "Founder private instance");

    const founderSettings = await server.api("/api/v1/settings");
    const otherSettings = await server.api("/api/v1/settings", { headers });
    assert.equal(founderSettings.status, 200);
    assert.equal(otherSettings.status, 200);
    await server.api("/api/v1/settings/theme", {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ theme: "light" }),
    });
    const otherBackground = await server.api("/api/v1/settings/background", {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ background_kind: "bundled", background_value: "mountains" }),
    });
    assert.equal(otherBackground.status, 200);
    const founderAfterOtherUpdate = await server.api("/api/v1/settings");
    assert.notEqual((founderAfterOtherUpdate.json as { theme: string }).theme, "light");
    assert.notEqual((founderAfterOtherUpdate.json as { background_kind: string }).background_kind, "bundled");
  } finally {
    await server.close();
  }
});
