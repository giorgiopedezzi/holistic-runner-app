/**
 * test/http/plan-instances-active.test.ts (HRA-248)
 * GET /api/v1/plan-instances/active?date=YYYY-MM-DD — "Your agenda"'s
 * today-centered home view: the one APPROVED plan instance whose resolved
 * days cover `date`, same response shape as GET /api/v1/plan-instances/:id.
 *
 * A single-week template (D1 declared, D2-D7 auto-fill as REST per HRA-124)
 * instantiated at a fixed start_date gives a deterministic 7-day span
 * (start_date .. start_date+6) with one workout day and six REST days,
 * covering every case the Story's own test list names without depending on
 * the real system clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`;
const START_DATE = "2026-09-01"; // first day
const LAST_DATE = "2026-09-07"; // start_date + 6
const REST_DATE = "2026-09-04"; // an auto-filled REST day within the span
const BEFORE_RANGE = "2026-08-31";
const AFTER_RANGE = "2026-09-08";

async function createApprovedInstance(server: Awaited<ReturnType<typeof startTestServer>>, name: string, startDate = START_DATE) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${name} template`, event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, start_date: startDate }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;

  const approved = await server.api(`/api/v1/plan-instances/${instanceId}/approve`, { method: "POST" });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  return instanceId;
}

test("GET .../active resolves a declared workout day within an approved instance", async () => {
  const server = await startTestServer();
  try {
    const instanceId = await createApprovedInstance(server, "Workout day fixture");
    const res = await server.api(`/api/v1/plan-instances/active?date=${START_DATE}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).id, instanceId);
    const day = (res.json as any).days.find((d: any) => d.date === START_DATE);
    assert.ok(day, "expected a day row for the start date");
    assert.equal(day.workout_type, "run");
  } finally {
    await server.close();
  }
});

test("GET .../active resolves an auto-filled REST day within an approved instance", async () => {
  const server = await startTestServer();
  try {
    await createApprovedInstance(server, "Rest day fixture");
    const res = await server.api(`/api/v1/plan-instances/active?date=${REST_DATE}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const day = (res.json as any).days.find((d: any) => d.date === REST_DATE);
    assert.ok(day, "expected a day row for the rest date");
    assert.equal(day.workout_type, "rest");
  } finally {
    await server.close();
  }
});

test("GET .../active resolves the plan's first and last day", async () => {
  const server = await startTestServer();
  try {
    await createApprovedInstance(server, "Boundary fixture");
    const first = await server.api(`/api/v1/plan-instances/active?date=${START_DATE}`);
    assert.equal(first.status, 200);
    const last = await server.api(`/api/v1/plan-instances/active?date=${LAST_DATE}`);
    assert.equal(last.status, 200);
  } finally {
    await server.close();
  }
});

test("GET .../active 404s when the date falls outside every approved instance's resolved range", async () => {
  const server = await startTestServer();
  try {
    await createApprovedInstance(server, "Range-excluded fixture");
    const before = await server.api(`/api/v1/plan-instances/active?date=${BEFORE_RANGE}`);
    assert.equal(before.status, 404);
    const after = await server.api(`/api/v1/plan-instances/active?date=${AFTER_RANGE}`);
    assert.equal(after.status, 404);
  } finally {
    await server.close();
  }
});

test("GET .../active 404s when no plan instance is approved, even if an unapproved one covers the date", async () => {
  const server = await startTestServer();
  try {
    const t = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unapproved template", event: "marathon", dsl_source: DSL }),
    });
    const templateId = (t.json as any).id as number;
    await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unapproved instance", start_date: START_DATE }),
    });
    // Never approved — .../active must not surface it.
    const res = await server.api(`/api/v1/plan-instances/active?date=${START_DATE}`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("GET .../active rejects a missing or malformed date", async () => {
  const server = await startTestServer();
  try {
    const missing = await server.api("/api/v1/plan-instances/active");
    assert.equal(missing.status, 400);
    const malformed = await server.api("/api/v1/plan-instances/active?date=not-a-date");
    assert.equal(malformed.status, 400);
  } finally {
    await server.close();
  }
});
