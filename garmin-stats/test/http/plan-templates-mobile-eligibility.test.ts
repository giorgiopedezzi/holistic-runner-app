/**
 * test/http/plan-templates-mobile-eligibility.test.ts (HRA-302)
 * GET .../mobile-eligibility and POST .../instantiate/preview — both
 * read-only, never persist a plan_instances row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const ELIGIBLE_DSL = `PACE RG=TBD
PACE FL=RG+45s/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
D2 [easy]: 5km @ FL
`;

const AMBIGUOUS_DSL = `PACE RG=TBD
PACE FM=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
D2 [easy]: 5km @ FM
`;

async function createTemplate(server: Awaited<ReturnType<typeof startTestServer>>, name: string, dsl: string) {
  const res = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, event: "marathon", dsl_source: dsl }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return (res.json as { id: number }).id;
}

test("GET /api/v1/plan-templates/:id/mobile-eligibility: eligible template names its single anchor", async () => {
  const server = await startTestServer();
  try {
    const id = await createTemplate(server, "Eligible", ELIGIBLE_DSL);
    const res = await server.api(`/api/v1/plan-templates/${id}/mobile-eligibility`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { eligible: true, race_pace_anchor: "RG", distance_m: 42195, reason: null });
  } finally {
    await server.close();
  }
});

test("GET /api/v1/plan-templates/:id/mobile-eligibility: two required anchors -> not eligible", async () => {
  const server = await startTestServer();
  try {
    const id = await createTemplate(server, "Ambiguous", AMBIGUOUS_DSL);
    const res = await server.api(`/api/v1/plan-templates/${id}/mobile-eligibility`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as { eligible: boolean; race_pace_anchor: string | null; reason: string | null };
    assert.equal(body.eligible, false);
    assert.equal(body.race_pace_anchor, null);
    assert.equal(body.reason, "ambiguous-anchors");
  } finally {
    await server.close();
  }
});

test("GET /api/v1/plan-templates/:id/mobile-eligibility: 404 for an unknown template", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/999999/mobile-eligibility");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("POST /api/v1/plan-templates/:id/instantiate/preview: resolves paces and never persists an instance", async () => {
  const server = await startTestServer();
  try {
    const id = await createTemplate(server, "Preview me", ELIGIBLE_DSL);

    const preview = await server.api(`/api/v1/plan-templates/${id}/instantiate/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: "2026-09-14", goal_time: "03:30:00", race_pace_anchor: "RG" }),
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const body = preview.json as { start_date: string; race_pace_anchor: string; resolved_paces: Record<string, number>; needs_review: boolean };
    assert.equal(body.start_date, "2026-09-14");
    assert.equal(body.race_pace_anchor, "RG");
    assert.equal(body.needs_review, false);
    assert.ok(body.resolved_paces.RG > 0);
    assert.ok(body.resolved_paces.FL > body.resolved_paces.RG);

    const instances = await server.api(`/api/v1/plan-instances?template_id=${id}`);
    assert.equal((instances.json as { page: { total: number } }).page.total, 0, "preview must not persist an instance");
  } finally {
    await server.close();
  }
});

test("POST /api/v1/plan-templates/:id/instantiate/preview: goal_time without race_pace_anchor is rejected", async () => {
  const server = await startTestServer();
  try {
    const id = await createTemplate(server, "No anchor", ELIGIBLE_DSL);
    const res = await server.api(`/api/v1/plan-templates/${id}/instantiate/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: "2026-09-14", goal_time: "03:30:00" }),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});
