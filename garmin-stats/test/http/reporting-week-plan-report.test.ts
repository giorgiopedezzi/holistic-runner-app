/**
 * test/http/reporting-week-plan-report.test.ts (HRA-338)
 * GET /api/v1/plan-instances/:id/reports/weeks and .../reports/plan through
 * the real HTTP pipeline — the week/entire-plan reports built on top of
 * HRA-335's shared buildReport engine. The pure week-membership/grouping
 * logic is covered at the domain level (test/domain/reporting/report.test.ts,
 * plan-report.test.ts, aggregate-evidence.test.ts); this file proves the read
 * boundary + HTTP contract: 404s, query-param validation, and that a week's
 * own report/evidence stays confined to that week rather than leaking the
 * whole plan in.
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
SECTION "Base" WEEKS 2
WEEK 1
D1: 10km @ RG
WEEK 2
D1: 12km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>, extra: Record<string, unknown> = {}) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Week/plan report fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Week/plan report instance", start_date: startDate, schedule_timezone: "Europe/Rome", ...extra }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;
  const days = (inst.json as any).days as any[];
  const week1 = days.find(d => d.week_number === 1);
  const week2 = days.find(d => d.week_number === 2);
  return { instanceId, week1, week2 };
}

test("200: week report scopes datasets/workouts to that week only, not the whole plan", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, week1 } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base&week_number=1&range=full_plan`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.provenance.sectionName, "Base");
    assert.equal(body.provenance.weekNumber, 1);
    assert.equal(body.report.datasets.current.distanceM, 10000, "week 1's own 10km day only, never week 2's 12km");
    // Every week instantiates a full 7-day week (D1 explicit, D2-D7 default
    // rest/todo placeholders) — all of them belong to week 1, none to week 2.
    assert.equal(body.workouts.length, 7);
    assert.ok(body.workouts.some((w: any) => w.workoutId === week1.workout_id && w.weekNumber === 1));
    assert.ok(body.workouts.every((w: any) => w.weekNumber === 1), "no week-2 workout leaks into week 1's own report");
    assert.equal(body.evidence.hr, null);
    assert.equal(body.evidence.comparableStamina, null);
  } finally {
    await server.close();
  }
});

test("404: unknown plan instance id", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-instances/999999/reports/weeks?section_name=Base&week_number=1");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("404: a week that never existed on this instance", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base&week_number=99`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("400: missing week_number", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base`);
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("400: an invalid range value is rejected rather than silently defaulted", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base&week_number=1&range=whenever`);
    assert.equal(res.status, 400);
  } finally {
    await server.close();
  }
});

test("200: an accepted association in week 1 shows up in week 1's own evidence and is absent from week 2's", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, week1, week2 } = await setUp(server);
    const info = server.db.prepare(`
      INSERT INTO activities (filename, activity_date, date_only, sport, source, distance_m, duration_sec, moving_time_sec, avg_hr, max_hr)
      VALUES ('week-report-fixture.fit', ?, ?, 'running', 'garmin', 10100, 3050, 3000, 150, 170)
    `).run(`${week1.date}T07:00:00`, week1.date);
    const activityId = Number(info.lastInsertRowid);

    const link = await server.api(`/api/v1/activities/${activityId}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: week1.workout_id }),
    });
    assert.equal(link.status, 200, JSON.stringify(link.json));

    const week1Res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base&week_number=1&range=full_plan`);
    assert.equal(week1Res.status, 200, JSON.stringify(week1Res.json));
    const week1Body = week1Res.json as any;
    assert.equal(week1Body.report.coverage.trustedActivities, 1);
    assert.equal(week1Body.evidence.hr.avgHr, 150);

    const week2Res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/weeks?section_name=Base&week_number=2&range=full_plan`);
    assert.equal(week2Res.status, 200, JSON.stringify(week2Res.json));
    const week2Body = week2Res.json as any;
    assert.equal(week2Body.report.coverage.trustedActivities, 0, "week 2 never sees week 1's own activity");
    assert.equal(week2Body.evidence.hr, null);
    void week2;
  } finally {
    await server.close();
  }
});

test("200: entire-plan report groups by week and carries an overall total across both", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/reports/plan?range=full_plan`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.weeks.length, 2);
    assert.equal(body.weeks[0].key.week_number, 1);
    assert.equal(body.weeks[1].key.week_number, 2);
    assert.equal(body.weeks[0].report.datasets.current.distanceM, 10000);
    assert.equal(body.weeks[1].report.datasets.current.distanceM, 12000);
    assert.equal(body.overall.datasets.current.distanceM, 22000, "the whole plan's own total, both weeks combined");
  } finally {
    await server.close();
  }
});

test("404: a non-numeric instance id doesn't match the route at all", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-instances/not-a-number/reports/plan");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
