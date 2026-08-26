/**
 * test/http/plan-instance-day-validate.test.ts (HRA-162)
 * POST /api/v1/plan-instances/:id/days/:dayId/validate — parse-only preview
 * of a day's DSL edit, never persists. Mirrors
 * plan-instance-day-patch.test.ts's fixture, but every assertion here checks
 * that the day's actually-persisted row is untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PLAN
NAME Smoke Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-01
D1: 5km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Day validate fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));

  const inst = await server.api(`/api/v1/plan-templates/${(t.json as any).id}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Instance", start_date: "2026-09-01" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;
  const days = (inst.json as any).days as any[];
  const day = days.find(d => d.date === "2026-09-01");
  return { instanceId, dayId: day.id as number };
}

async function validateDay(server: Awaited<ReturnType<typeof startTestServer>>, instanceId: number, dayId: number, dsl: string) {
  return server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/validate`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dsl }),
  });
}

test("POST .../validate returns needs_review:false and no warnings for a clean edit", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await validateDay(server, instanceId, dayId, "D1: 8km @ RG");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { needs_review: false, warnings: [] });
  } finally {
    await server.close();
  }
});

test("POST .../validate returns needs_review:true + the parser's own warnings for unresolved input, and never a 422", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await validateDay(server, instanceId, dayId, "D1: garbled nonsense");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.needs_review, true);
    assert.ok(body.warnings.length > 0, JSON.stringify(body));
  } finally {
    await server.close();
  }
});

test("POST .../validate never persists — the day's real row is unchanged after a flagged preview", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const before = await server.api(`/api/v1/plan-instances/${instanceId}`);
    const dayBefore = ((before.json as any).days as any[]).find(d => d.id === dayId);

    await validateDay(server, instanceId, dayId, "D1: 20km @ RG");

    const after = await server.api(`/api/v1/plan-instances/${instanceId}`);
    const dayAfter = ((after.json as any).days as any[]).find(d => d.id === dayId);
    assert.deepEqual(dayAfter, dayBefore);
  } finally {
    await server.close();
  }
});

test("POST .../validate rejects a blank dsl (422)", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await validateDay(server, instanceId, dayId, "   ");
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST .../validate 404s for an unknown instance", async () => {
  const server = await startTestServer();
  try {
    const { dayId } = await setUp(server);
    const res = await validateDay(server, 999999, dayId, "D1: 8km @ RG");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("POST .../validate 404s for a day that belongs to a different instance", async () => {
  const server = await startTestServer();
  try {
    const { instanceId: instanceA } = await setUp(server);
    const { dayId: dayFromB } = await setUp(server);
    const res = await validateDay(server, instanceA, dayFromB, "D1: 8km @ RG");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("POST .../validate still works on an already-approved instance (no mutation to guard)", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const approved = await server.api(`/api/v1/plan-instances/${instanceId}/approve`, { method: "POST" });
    assert.equal(approved.status, 200);
    assert.ok((approved.json as any).approved_at, "fixture must actually be approved before this assertion is meaningful");

    const res = await validateDay(server, instanceId, dayId, "D1: 8km @ RG");
    assert.equal(res.status, 200, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});
