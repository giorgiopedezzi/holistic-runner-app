/**
 * test/http/activities-association.test.ts (HRA-334)
 * GET/PUT/DELETE /api/v1/activities/:id/association + GET .../association-
 * candidates through the real HTTP pipeline. Automatic-matching itself is
 * covered exhaustively at the domain level (test/domain/workout-association.
 * test.ts) — this file proves the manual HTTP contract: inspect, confirm,
 * replace, remove, and validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-14
D1: 5km @ RG
D2: 6km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Association fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Association instance", start_date: "2026-09-14", schedule_timezone: "Europe/Rome" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const days = (inst.json as any).days as { workout_id: string; day: number }[];

  const row = await server.db.get<{ id: number }>(`
    INSERT INTO activities (user_id, filename, activity_date, date_only, sport, source)
    VALUES ('00000000-0000-4000-8000-000000000001', 'assoc-fixture.fit', '2026-09-14T07:00:00', '2026-09-14', 'running', 'garmin')
    RETURNING id
  `);
  if (!row) throw new Error("fixture activity insert did not return an id");
  const activityId = row.id;

  return {
    activityId,
    workoutIdD1: days.find(d => d.day === 1)!.workout_id,
    workoutIdD2: days.find(d => d.day === 2)!.workout_id,
  };
}

test("GET .../association returns an all-null view when nothing is linked yet (not a 404)", async () => {
  const server = await startTestServer();
  try {
    const { activityId } = await setUp(server);
    const res = await server.api(`/api/v1/activities/${activityId}/association`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      activity_id: activityId, workout_id: null, status: null,
      instance_id: null, instance_name: null, section_name: null, week_number: null, date: null,
    });
  } finally {
    await server.close();
  }
});

test("GET .../association 404s for an unknown activity", async () => {
  const server = await startTestServer();
  try {
    await setUp(server);
    const res = await server.api("/api/v1/activities/999999/association");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("GET .../association-candidates lists only the 'run' day sharing the activity's local date (D2 is the next day, not a candidate)", async () => {
  const server = await startTestServer();
  try {
    const { activityId, workoutIdD1 } = await setUp(server);
    const res = await server.api(`/api/v1/activities/${activityId}/association-candidates`);
    assert.equal(res.status, 200);
    const workoutIds = (res.json as { workout_id: string }[]).map(d => d.workout_id);
    assert.deepEqual(workoutIds, [workoutIdD1]);
  } finally {
    await server.close();
  }
});

test("PUT .../association sets a first-ever manual pick to manual_changed, with full plan-day context", async () => {
  const server = await startTestServer();
  try {
    const { activityId, workoutIdD1 } = await setUp(server);
    const res = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.workout_id, workoutIdD1);
    assert.equal(body.status, "manual_changed");
    assert.equal(body.section_name, "Base");
    assert.equal(body.week_number, 1);
    assert.equal(body.date, "2026-09-14");
  } finally {
    await server.close();
  }
});

test("PUT .../association with the SAME workout_id already on record becomes manual_confirmed", async () => {
  const server = await startTestServer();
  try {
    const { activityId, workoutIdD1 } = await setUp(server);
    await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    const res = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    assert.equal(res.status, 200);
    assert.equal((res.json as any).status, "manual_confirmed");
  } finally {
    await server.close();
  }
});

test("PUT .../association with a DIFFERENT workout_id than what's on record becomes manual_changed (replace)", async () => {
  const server = await startTestServer();
  try {
    const { activityId, workoutIdD1, workoutIdD2 } = await setUp(server);
    await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    const res = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD2 }),
    });
    assert.equal(res.status, 200);
    const body = res.json as any;
    assert.equal(body.workout_id, workoutIdD2);
    assert.equal(body.status, "manual_changed");
  } finally {
    await server.close();
  }
});

test("PUT .../association 422s for a workout_id that doesn't name any current plan day", async () => {
  const server = await startTestServer();
  try {
    const { activityId } = await setUp(server);
    const res = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: "not-a-real-id" }),
    });
    assert.equal(res.status, 422);
  } finally {
    await server.close();
  }
});

test("PUT .../association 404s for an unknown activity", async () => {
  const server = await startTestServer();
  try {
    const { workoutIdD1 } = await setUp(server);
    const res = await server.api("/api/v1/activities/999999/association", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("DELETE .../association explicitly marks the activity unplanned (workout_id null, manual_changed) — a real row, never a 404 afterward", async () => {
  const server = await startTestServer();
  try {
    const { activityId, workoutIdD1 } = await setUp(server);
    await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutIdD1 }),
    });
    const res = await server.api(`/api/v1/activities/${activityId}/association`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      activity_id: activityId, workout_id: null, status: "manual_changed",
      instance_id: null, instance_name: null, section_name: null, week_number: null, date: null,
    });

    const after = await server.api(`/api/v1/activities/${activityId}/association`);
    assert.equal(after.status, 200);
    assert.equal((after.json as any).status, "manual_changed");
  } finally {
    await server.close();
  }
});
