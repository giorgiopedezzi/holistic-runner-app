/**
 * test/http/reporting-range-report.test.ts (HRA-341)
 * GET /api/v1/reports/range through the real HTTP pipeline — the date-range/
 * race-range report. Cross-instance aggregation/grouping is covered at the
 * domain level (test/domain/reporting/range-report.test.ts,
 * report.test.ts's own dateWindow cases); this file proves the read
 * boundary + HTTP contract, and the ONE property no single-instance report
 * test can exercise: that two DIFFERENT plan instances' own evidence never
 * leaks into each other's per-instance report within the same window
 * (Scope: "handle cross-plan ... periods without corrupting dataset
 * identity").
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
const from = startDate;
const to = addDays(startDate, 6);

const SIMPLE_DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 10km @ RG
`;

const QUALITY_DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 3x1000m @ RG r:200m @ RG+120
`;

async function createInstance(server: Awaited<ReturnType<typeof startTestServer>>, name: string, dsl = SIMPLE_DSL) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${name} template`, event: "marathon", dsl_source: dsl }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, start_date: startDate, schedule_timezone: "Europe/Rome" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { instanceId: (inst.json as any).id as number, workoutId: (inst.json as any).days[0].workout_id as string };
}

async function insertActivity(server: Awaited<ReturnType<typeof startTestServer>>, distanceM: number, durationSec: number): Promise<number> {
  const row = await server.db.get<{ id: number }>("INSERT INTO activities (user_id,filename,activity_date,date_only,sport,source,distance_m,duration_sec,moving_time_sec) VALUES ('00000000-0000-4000-8000-000000000001',$1,$2,$3,'running','garmin',$4,$5,$5) RETURNING id", [`range-report-fixture-${Math.random()}.fit`, `${startDate}T07:00:00`, startDate, distanceM, durationSec]);
  if (!row) throw new Error("fixture activity insert did not return an id");
  return row.id;
}

async function linkActivity(server: Awaited<ReturnType<typeof startTestServer>>, activityId: number, workoutId: string) {
  const res = await server.api(`/api/v1/activities/${activityId}/association`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: workoutId }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
}

test("400: missing from/to", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/reports/range");
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("400: from after to", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api(`/api/v1/reports/range?from=${to}&to=${from}`);
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("200: an empty window (no plan instances, no activities) returns explicit empty state, never an error", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.deepEqual(body.instances, []);
    assert.deepEqual(body.unplanned, []);
    assert.equal(body.aggregate.coverage.totalActivitiesInScope, 0);
    assert.equal(body.aggregate.datasets.current.distanceM, undefined);
  } finally {
    await server.close();
  }
});

test("200: one instance in scope with accepted evidence is reflected in both the per-instance and aggregate datasets", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, workoutId } = await createInstance(server, "Range report solo instance");
    const activityId = await insertActivity(server, 10000, 3000);
    await linkActivity(server, activityId, workoutId);

    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}&range=full_plan`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.instances.length, 1);
    assert.equal(body.instances[0].instanceId, instanceId);
    assert.equal(body.instances[0].report.datasets.current.distanceM, 10000);
    assert.equal(body.instances[0].report.datasets.actual.distanceM, 10000);
    assert.equal(body.aggregate.datasets.current.distanceM, 10000);
    assert.equal(body.aggregate.datasets.actual.distanceM, 10000);
    assert.equal(body.aggregate.coverage.trustedActivities, 1);
  } finally {
    await server.close();
  }
});

test("200: two DIFFERENT plan instances in the same window never leak evidence into each other's own report (cross-plan dataset identity)", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, "Range report instance A");
    const b = await createInstance(server, "Range report instance B");
    const activityA = await insertActivity(server, 10000, 3000);
    await linkActivity(server, activityA, a.workoutId);

    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}&range=full_plan`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.instances.length, 2);
    const reportA = body.instances.find((i: any) => i.instanceId === a.instanceId).report;
    const reportB = body.instances.find((i: any) => i.instanceId === b.instanceId).report;
    assert.equal(reportA.datasets.actual.distanceM, 10000, "instance A's own accepted activity");
    assert.equal(reportB.datasets.actual.distanceM, 0, "instance B has no evidence of its own — never A's");
    assert.equal(body.aggregate.datasets.actual.distanceM, 10000, "the aggregate still counts A's evidence exactly once");
    assert.equal(body.aggregate.coverage.trustedActivities, 1);
  } finally {
    await server.close();
  }
});

test("200: an activity with no plan association at all is reported as unplanned (Actual-only), never as trusted or dropped", async () => {
  const server = await startTestServer();
  try {
    await createInstance(server, "Range report unplanned fixture");
    const extraActivityId = await insertActivity(server, 5000, 1500);

    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.unplanned.length, 1);
    assert.equal(body.unplanned[0].activity_id, extraActivityId);
    assert.equal(body.aggregate.coverage.extraActivities, 1);
    assert.equal(body.aggregate.coverage.trustedActivities, 0);
  } finally {
    await server.close();
  }
});

test("200: a repetition-classified workout with accepted (but unaligned) evidence is visible in qualityEvidence as unavailable, never fabricated as aligned", async () => {
  const server = await startTestServer();
  try {
    const { workoutId } = await createInstance(server, "Range report quality fixture", QUALITY_DSL);
    const activityId = await insertActivity(server, 3600, 900);
    await linkActivity(server, activityId, workoutId);

    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.qualityEvidence.totalWorkouts, 1);
    assert.equal(body.qualityEvidence.workoutsWithEvidence, 0);
    assert.equal(body.qualityEvidence.workouts[0].workoutId, workoutId);
    assert.equal(body.qualityEvidence.workouts[0].comparison.kind, "repetition");
    assert.equal(body.qualityEvidence.workouts[0].comparison.available, false);
  } finally {
    await server.close();
  }
});

test("200: provenance carries the requested window, resolved range mode, and an automatic grouping mode", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api(`/api/v1/reports/range?from=${from}&to=${to}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.provenance.from, from);
    assert.equal(body.provenance.to, to);
    assert.equal(body.provenance.range, "plan_to_date");
    assert.equal(body.provenance.grouping, "workout");
  } finally {
    await server.close();
  }
});
