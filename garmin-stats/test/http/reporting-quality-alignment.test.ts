/**
 * test/http/reporting-quality-alignment.test.ts (HRA-342)
 * PUT/DELETE .../reports/workouts/:workoutId/quality-alignment/:segmentIndex
 * through the real HTTP pipeline, and the resulting structuredQualityEvidence
 * on the workout report. Pure alignment/classification logic is covered
 * exhaustively at the domain level (quality-workout.test.ts,
 * quality-evidence.test.ts) — this file proves the read/write boundary: the
 * activity-must-be-accepted-evidence rule, persistence, and end-to-end wiring
 * into GET .../reports/workouts/:workoutId.
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
D1: 3x1000m @ RG r:200m @ RG+120
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Quality alignment fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Quality alignment instance", start_date: startDate, schedule_timezone: "Europe/Rome" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;
  const workoutId = (inst.json as any).days[0].workout_id as string;
  return { instanceId, workoutId };
}

function insertActivity(server: Awaited<ReturnType<typeof startTestServer>>, distanceM: number, durationSec: number): number {
  const info = server.db.prepare(`
    INSERT INTO activities (filename, activity_date, date_only, sport, source, distance_m, duration_sec, moving_time_sec)
    VALUES (?, ?, ?, 'running', 'garmin', ?, ?, ?)
  `).run(`qa-fixture-${Math.random()}.fit`, `${startDate}T07:00:00`, startDate, distanceM, durationSec, durationSec);
  return Number(info.lastInsertRowid);
}

test("workout report classifies the interval day as 'repetition' with 3 work + 3 recovery entries, unavailable with no evidence", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const sqe = (res.json as any).structuredQualityEvidence;
    assert.equal(sqe.kind, "repetition");
    assert.equal(sqe.available, false);
    assert.equal(sqe.segments.length, 6);
  } finally {
    await server.close();
  }
});

test("422: setting a manual alignment against an activity that isn't accepted evidence for this workout is rejected", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const activityId = insertActivity(server, 1000, 240);
    // never linked to workoutId via the association endpoint
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}/quality-alignment/0`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_id: activityId, distance_m: 1000, duration_sec: 235 }),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("200: a manual alignment against an accepted activity is persisted and reflected in the workout report", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const activityId = insertActivity(server, 3600, 900);
    const link = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutId }),
    });
    assert.equal(link.status, 200, JSON.stringify(link.json));

    const put = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}/quality-alignment/0`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_id: activityId, distance_m: 1000, duration_sec: 235 }),
    });
    assert.equal(put.status, 200, JSON.stringify(put.json));

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    const sqe = (res.json as any).structuredQualityEvidence;
    assert.equal(sqe.available, true);
    const seg0 = sqe.segments.find((s: any) => s.segment.index === 0);
    assert.equal(seg0.actual.provenance, "manual");
    assert.equal(seg0.actual.distanceM, 1000);
    assert.equal(seg0.actual.durationSec, 235);
    assert.equal(seg0.actual.activityId, activityId);
  } finally {
    await server.close();
  }
});

test("200: removing a manual alignment reverts the segment to unavailable, without touching the activity row", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await setUp(server);
    const activityId = insertActivity(server, 3600, 900);
    await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutId }),
    });
    await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}/quality-alignment/0`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_id: activityId, distance_m: 1000, duration_sec: 235 }),
    });

    const del = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}/quality-alignment/0`, { method: "DELETE" });
    assert.equal(del.status, 200, JSON.stringify(del.json));

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/workouts/${workoutId}`);
    const sqe = (res.json as any).structuredQualityEvidence;
    assert.equal(sqe.available, false);

    const activity = await server.api(`/api/v1/activities/${activityId}/association`);
    assert.equal(activity.status, 200);
  } finally {
    await server.close();
  }
});
