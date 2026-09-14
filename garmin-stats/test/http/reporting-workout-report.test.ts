/**
 * test/http/reporting-workout-report.test.ts (HRA-336)
 * GET /api/v1/plan-instances/:id/reports/workouts/:workoutId through the real
 * HTTP pipeline. The pure calculation itself is covered exhaustively at the
 * domain level (test/domain/reporting/workout-report.test.ts) — this file
 * proves the read boundary + HTTP contract: 404s, association evidence
 * wiring, and provenance.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const startDate = addDays(today, 1);

const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 10km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>, extra: Record<string, unknown> = {}) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Report fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Report instance", start_date: startDate, schedule_timezone: "Europe/Rome", ...extra }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;
  const workoutId = (inst.json as any).days[0].workout_id as string;
  return { instanceId, workoutId };
}

test("200: a freshly instantiated workout reports Original==Current ('unchanged'), no actual evidence yet", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.lineage, "unchanged");
    assert.equal(body.originalEqualsCurrent, true);
    assert.equal(body.planned.current.distanceM, 10000);
    assert.equal(body.actual.metrics, null);
    assert.equal(body.provenance.currentRevision, 1);
    assert.equal(body.provenance.originalRevision, 1);
    assert.equal(body.race.isRace, false);
  } finally {
    await server.close();
  }
});

test("404: unknown plan instance id", async () => {
  const server = await startTestServer();
  try {
    const { workoutId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/999999/reports/workouts/${workoutId}`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("404: a workout_id that never belonged to this instance", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/not-a-real-workout-id`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("404: a non-numeric instance id doesn't match the route at all (same as every other /plan-instances/:id route)", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-instances/not-a-number/reports/workouts/w1");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("200: an accepted association's activity feeds actual metrics and evidence", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const row = await server.db.get<{ id: number }>("INSERT INTO activities (user_id,filename,activity_date,date_only,sport,source,distance_m,duration_sec,moving_time_sec) VALUES ('00000000-0000-4000-8000-000000000001','report-fixture.fit',$1,$2,'running','garmin',10100,3050,3000) RETURNING id", [`${startDate}T07:00:00`, startDate]);
    if (!row) throw new Error("fixture activity insert did not return an id");
    const activityId = row.id;

    const link = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutId }),
    });
    assert.equal(link.status, 200, JSON.stringify(link.json));

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.actual.metrics.distanceM, 10100);
    assert.equal(body.actual.evidence.length, 1);
    assert.equal(body.actual.evidence[0].status, "manual_changed");
  } finally {
    await server.close();
  }
});

test("consistent read boundary: a report taken before a mutation and one taken after never mix content across revisions", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);

    const before = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    assert.equal(before.status, 200, JSON.stringify(before.json));
    const beforeBody = before.json as any;
    assert.equal(beforeBody.provenance.currentRevision, 1);
    assert.equal(beforeBody.planned.current.distanceM, 10000);

    const patched = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ section_name: "Base", week_number: 1, date: startDate, dsl: "D1: 15km @ RG" }] }),
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    const newWorkoutId = (patched.json as any).days[0].workout_id as string;

    const after = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${newWorkoutId}`);
    assert.equal(after.status, 200, JSON.stringify(after.json));
    const afterBody = after.json as any;
    // The new revision arrives together with the new content — never the
    // OLD revision number paired with the NEW distance, or vice versa.
    assert.equal(afterBody.provenance.currentRevision, 2);
    assert.equal(afterBody.planned.current.distanceM, 15000);
  } finally {
    await server.close();
  }
});

test("200: race day (workout date matches the instance's race_date) exposes target + elapsed-time actual fields", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server, { race_date: startDate });
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.race.isRace, true);
    assert.equal(body.race.targetDistanceM, 10000);
    assert.equal(body.race.actualSource, "none", "no accepted evidence yet");
  } finally {
    await server.close();
  }
});
