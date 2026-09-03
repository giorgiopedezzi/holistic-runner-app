/**
 * test/http/plan-instance-day-patch.test.ts (HRA-149)
 * PATCH /api/v1/plan-instances/:id/days/:dayId — a smaller, more honest write
 * than the bulk PATCH .../plan-instances/:id's wholesale `days` replace: one
 * field's worth of edit ({dsl?, notes?, scheduled_time?}) on one
 * already-existing day, each field validated independently.
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
    body: JSON.stringify({ name: "Day patch fixture", event: "marathon", dsl_source: DSL }),
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

async function patchDay(server: Awaited<ReturnType<typeof startTestServer>>, instanceId: number, dayId: number, body: unknown) {
  return server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("PATCH .../days/:dayId updates scheduled_time only, leaves dsl-derived fields untouched", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { scheduled_time: "06:30" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    assert.equal(updated.scheduled_time, "06:30");
    assert.equal(updated.workout_type, "run");
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId updates notes only", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { notes: "feeling good" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).notes, "feeling good");
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId re-parses+resolves a supplied dsl", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { dsl: "D1: 8km @ RG" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    const segments = JSON.parse(updated.segments);
    assert.equal(segments[0].target.distance_m, 8000, updated.segments);
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId: an explicit notes overrides whatever the dsl parse itself produced", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { dsl: "D1: 8km @ RG # from dsl", notes: "explicit override" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).notes, "explicit override");
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId rejects an invalid scheduled_time format", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { scheduled_time: "6:30am" });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId clears scheduled_time via explicit null", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    await patchDay(server, instanceId, dayId, { scheduled_time: "06:30" });
    const res = await patchDay(server, instanceId, dayId, { scheduled_time: null });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).scheduled_time, null);
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId rejects a dsl that still needs review", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, { dsl: "D1: garbled nonsense" });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId rejects an empty body", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const res = await patchDay(server, instanceId, dayId, {});
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId still succeeds once the instance is approved (HRA-249: the edit lock is a frontend warning now)", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, dayId } = await setUp(server);
    const approved = await server.api(`/api/v1/plan-instances/${instanceId}/approve`, { method: "POST" });
    assert.equal(approved.status, 200);
    assert.ok((approved.json as any).approved_at, "fixture must actually be approved before this assertion is meaningful");

    const res = await patchDay(server, instanceId, dayId, { scheduled_time: "06:30" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).scheduled_time, "06:30");
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId 404s for an unknown instance", async () => {
  const server = await startTestServer();
  try {
    const { dayId } = await setUp(server);
    const res = await patchDay(server, 999999, dayId, { scheduled_time: "06:30" });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("PATCH .../days/:dayId 404s for a day that belongs to a different instance", async () => {
  const server = await startTestServer();
  try {
    const { instanceId: instanceA } = await setUp(server);
    const { dayId: dayFromB } = await setUp(server);
    const res = await patchDay(server, instanceA, dayFromB, { scheduled_time: "06:30" });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
