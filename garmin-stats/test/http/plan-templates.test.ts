/**
 * test/http/plan-templates.test.ts (HRA-120)
 * POST/PUT /api/v1/plan-templates — event is now a required, validated
 * request field (replacing the old DSL-text EVENT line); distance_m is
 * required iff event === "custom", rejected otherwise. Also covers the
 * custom-event instantiate flow: goal_time without an explicit distance_m
 * falls back to the template's own distance_m (docs/runplan-dsl.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

// No PLAN header (HRA-120: now optional) and RG left deliberately unbound
// (PACE RG=TBD) so the template parses with zero warnings — the goal_time
// supplied at instantiate time supplies the concrete RG pace.
const DSL = `PACE RG=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`;

test("POST /api/v1/plan-templates requires event, one of the 5 valid values", async () => {
  const server = await startTestServer();
  try {
    const missing = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "No event", dsl_source: DSL }),
    });
    assert.equal(missing.status, 422, JSON.stringify(missing.json));

    const invalid = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad event", event: "ultra", dsl_source: DSL }),
    });
    assert.equal(invalid.status, 422, JSON.stringify(invalid.json));
  } finally {
    await server.close();
  }
});

test("POST /api/v1/plan-templates: distance_m required iff event === custom, rejected otherwise", async () => {
  const server = await startTestServer();
  try {
    const customNoDistance = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Custom no distance", event: "custom", dsl_source: DSL }),
    });
    assert.equal(customNoDistance.status, 422, JSON.stringify(customNoDistance.json));

    const marathonWithDistance = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marathon with distance", event: "marathon", distance_m: 42195, dsl_source: DSL }),
    });
    assert.equal(marathonWithDistance.status, 422, JSON.stringify(marathonWithDistance.json));

    const marathonOk = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marathon", event: "marathon", dsl_source: DSL }),
    });
    assert.equal(marathonOk.status, 201, JSON.stringify(marathonOk.json));
    assert.equal((marathonOk.json as any).event, "marathon");

    const customOk = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Custom", event: "custom", distance_m: 10000, dsl_source: DSL }),
    });
    assert.equal(customOk.status, 201, JSON.stringify(customOk.json));
    assert.equal((customOk.json as any).event, "custom");
  } finally {
    await server.close();
  }
});

test("Instantiating a custom-event template with goal_time and no explicit distance_m uses the template's own distance_m; an explicit distance_m overrides it", async () => {
  const server = await startTestServer();
  try {
    const created = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Custom 10K-equivalent", event: "custom", distance_m: 10000, dsl_source: DSL }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const templateId = (created.json as any).id;

    // 00:40:00 over the template's own 10000m -> RG = 240 sec/km.
    const usingTemplateDistance = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race A", start_date: "2026-09-01", goal_time: "00:40:00", race_pace_anchor: "RG" }),
    });
    assert.equal(usingTemplateDistance.status, 201, JSON.stringify(usingTemplateDistance.json));
    const days1 = (usingTemplateDistance.json as any).days;
    assert.equal(JSON.parse(days1[0].segments)[0].resolved_pace_sec_per_km, 240);

    // Same goal_time, explicit distance_m=5000 overrides the template's own -> RG = 480 sec/km.
    const withOverride = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race B", start_date: "2026-09-01", goal_time: "00:40:00", distance_m: 5000, race_pace_anchor: "RG" }),
    });
    assert.equal(withOverride.status, 201, JSON.stringify(withOverride.json));
    const days2 = (withOverride.json as any).days;
    assert.equal(JSON.parse(days2[0].segments)[0].resolved_pace_sec_per_km, 480);
  } finally {
    await server.close();
  }
});

// HRA-121: race_pace_anchor generalizes goal_time — it's no longer hardcoded
// to RG, and is required (no default) whenever goal_time is supplied.
const DSL_FM = `PACE FM=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ FM
`;

test("POST .../instantiate: race_pace_anchor is required when goal_time is supplied (no default)", async () => {
  const server = await startTestServer();
  try {
    const created = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marathon plan", event: "marathon", dsl_source: DSL_FM }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const templateId = (created.json as any).id;

    const missingAnchor = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race A", start_date: "2026-09-01", goal_time: "03:30:00" }),
    });
    assert.equal(missingAnchor.status, 422, JSON.stringify(missingAnchor.json));
  } finally {
    await server.close();
  }
});

test("POST .../instantiate: goal_time converts to whichever anchor race_pace_anchor names, not hardcoded RG", async () => {
  const server = await startTestServer();
  try {
    const created = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marathon plan", event: "marathon", dsl_source: DSL_FM }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const templateId = (created.json as any).id;

    // 03:30:00 over the marathon's standard 42195m -> FM = 298.75 sec/km.
    const instantiated = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race A", start_date: "2026-09-01", goal_time: "03:30:00", race_pace_anchor: "FM" }),
    });
    assert.equal(instantiated.status, 201, JSON.stringify(instantiated.json));
    const days = (instantiated.json as any).days;
    const resolved = JSON.parse(days[0].segments)[0].resolved_pace_sec_per_km;
    assert.ok(Math.abs(resolved - 12600 / 42.195) < 0.01, `expected ~298.75, got ${resolved}`);
  } finally {
    await server.close();
  }
});

test("POST .../instantiate: race_name/race_date persist and round-trip, independent of target_activity_id", async () => {
  const server = await startTestServer();
  try {
    const created = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Marathon plan", event: "marathon", dsl_source: DSL_FM }),
    });
    const templateId = (created.json as any).id;

    const instantiated = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Race A", start_date: "2026-09-01", goal_time: "03:30:00", race_pace_anchor: "FM",
        race_name: "Boston Marathon", race_date: "2026-04-20",
      }),
    });
    assert.equal(instantiated.status, 201, JSON.stringify(instantiated.json));
    assert.equal((instantiated.json as any).race_name, "Boston Marathon");
    assert.equal((instantiated.json as any).race_date, "2026-04-20");

    const instanceId = (instantiated.json as any).id;
    const fetched = await server.api(`/api/v1/plan-instances/${instanceId}`);
    assert.equal(fetched.status, 200);
    assert.equal((fetched.json as any).race_name, "Boston Marathon");
    assert.equal((fetched.json as any).race_date, "2026-04-20");

    // Both optional: omitting them entirely still succeeds, with null back.
    const withoutRace = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Race B", start_date: "2026-09-01", goal_time: "03:30:00", race_pace_anchor: "FM" }),
    });
    assert.equal(withoutRace.status, 201, JSON.stringify(withoutRace.json));
    assert.equal((withoutRace.json as any).race_name, null);
    assert.equal((withoutRace.json as any).race_date, null);
  } finally {
    await server.close();
  }
});
