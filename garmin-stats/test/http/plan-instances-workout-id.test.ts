/**
 * test/http/plan-instances-workout-id.test.ts (HRA-333)
 * Every plan_instance_days row's stable workout_id — assigned at
 * instantiation, and carried across the mutation paths that must preserve a
 * planned workout's identity independent of its placement: the bulk
 * days-replace (PATCH /plan-instances/:id), the single-day PATCH
 * (.../days/:dayId), the atomic swap (POST .../workouts/swap), and regenerate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PLAN
NAME Identity fixture
PACE RG=5:00/km
SECTION "Base" WEEKS 2
WEEK 1 START 2026-09-01
D1: 5km @ RG
D3: 8km @ RG
WEEK 2
D1: 6km @ RG
D3: 9km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Identity fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Identity instance", start_date: "2026-09-01" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { templateId, instanceId: (inst.json as any).id as number, days: (inst.json as any).days as any[] };
}

test("instantiate: every day gets its own distinct, non-empty workout_id", async () => {
  const server = await startTestServer();
  try {
    const { days } = await setUp(server);
    assert.ok(days.length > 0);
    for (const d of days) {
      assert.equal(typeof d.workout_id, "string");
      assert.ok(d.workout_id.length > 0);
    }
    assert.equal(new Set(days.map((d: any) => d.workout_id)).size, days.length, "every workout_id must be unique");
  } finally {
    await server.close();
  }
});

test("PATCH days: re-saving an untouched day (echoing its own workout_id back) keeps the same identity", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const target = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.ok(target);

    const body = days.map((d: any) => ({
      section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: reconstructDsl(d), workout_id: d.workout_id,
    }));
    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: body }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = (res.json as any).days as any[];
    const afterTarget = after.find(d => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.equal(afterTarget.workout_id, target.workout_id, "echoing the same workout_id back must preserve identity across the delete+recreate");
  } finally {
    await server.close();
  }
});

test("PATCH days: a swap exchanges workout_id along with content — identity follows the workout, not the slot", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const dayB = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.ok(dayA && dayB);

    // A swap exchanges workout CONTENT between two slots while each slot
    // keeps its own D-number prefix (same "swapDayContent" idea the real
    // frontend domain helper implements) — only the identity travels with
    // the content that now occupies each slot.
    const body = days.map((d: any) => {
      if (d === dayA) return { section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: reconstructDsl({ ...dayB, day: dayA.day }), workout_id: dayB.workout_id };
      if (d === dayB) return { section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: reconstructDsl({ ...dayA, day: dayB.day }), workout_id: dayA.workout_id };
      return { section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: reconstructDsl(d), workout_id: d.workout_id };
    });
    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: body }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = (res.json as any).days as any[];
    const afterA = after.find(d => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const afterB = after.find(d => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.equal(afterA.workout_id, dayB.workout_id, "slot A now holds B's workout, so it must carry B's identity");
    assert.equal(afterB.workout_id, dayA.workout_id, "slot B now holds A's workout, so it must carry A's identity");
  } finally {
    await server.close();
  }
});

test("PATCH days: a workout_id that doesn't belong to this instance's own current days is never trusted — a fresh id is minted instead", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const target = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);

    const body = days.map((d: any) => ({
      section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: reconstructDsl(d),
      workout_id: d === target ? "00000000-spoofed-not-a-real-current-id" : d.workout_id,
    }));
    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: body }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = (res.json as any).days as any[];
    const afterTarget = after.find(d => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.notEqual(afterTarget.workout_id, "00000000-spoofed-not-a-real-current-id");
    assert.notEqual(afterTarget.workout_id, target.workout_id);
  } finally {
    await server.close();
  }
});

// POST /api/v1/plan-instances/:id/workouts/swap (HRA-333 follow-up) — the
// single atomic operation that replaced the old two-call PATCH
// .../days/:dayId persistence above: each of those two calls was its own
// transaction, so the deferred (instance_id, workout_id) unique constraint
// on plan_instance_days could never actually resolve — the first call's row
// still collided with the second (as yet untouched) row at THAT call's own
// commit (500 "ON CONFLICT does not support deferrable unique constraints"
// under load, or a plain duplicate-key error at commit — see
// docs/architecture/POSTGRESQL-MIGRATION.md).
test("POST .../workouts/swap: exchanges workout_id (and its content) between two slots; each slot's own id/date never move", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const dayB = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.ok(dayA && dayB);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: dayB.id }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { day_a: afterA, day_b: afterB } = res.json as any;

    // Slot identity (id, date) never moves.
    assert.equal(afterA.id, dayA.id);
    assert.equal(afterA.date, dayA.date);
    assert.equal(afterB.id, dayB.id);
    assert.equal(afterB.date, dayB.date);

    // Workout identity — and the content that comes along with it via the
    // plan_instance_workouts join — exchanges slots.
    assert.equal(afterA.workout_id, dayB.workout_id, "slot A now holds B's workout");
    assert.equal(afterB.workout_id, dayA.workout_id, "slot B now holds A's workout");
    assert.equal(JSON.parse(afterA.segments)[0].target.distance_m, JSON.parse(dayB.segments)[0].target.distance_m);
    assert.equal(JSON.parse(afterB.segments)[0].target.distance_m, JSON.parse(dayA.segments)[0].target.distance_m);
  } finally {
    await server.close();
  }
});

test("POST .../workouts/swap: workout customization follows the workout identity, not the slot", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const dayB = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.ok(dayA && dayB);

    // Mark dayA's workout customized (any single-day PATCH with dsl sets
    // customized_at) — dayB is left untouched, so its customized_at stays null.
    const patched = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayA.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dsl: reconstructDsl(dayA) }),
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.ok((patched.json as any).customized_at, "dayA's workout should now be customized");

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: dayB.id }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const { day_a: afterA, day_b: afterB } = res.json as any;

    assert.equal(afterA.customized_at, null, "slot A now holds B's never-customized workout");
    assert.ok(afterB.customized_at, "slot B now holds A's customized workout, so the marker travels with it");
  } finally {
    await server.close();
  }
});

test("POST .../workouts/swap: an existing workout association stays attached to the same logical workout, unaffected by the swap", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const dayB = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.ok(dayA && dayB);

    const activity = await server.db.get<{ id: number }>(`
      INSERT INTO activities (user_id, filename, activity_date, date_only, sport, source)
      VALUES ('00000000-0000-4000-8000-000000000001', 'swap-fixture.fit', '2026-09-01T07:00:00', '2026-09-01', 'running', 'garmin')
      RETURNING id
    `);
    if (!activity) throw new Error("fixture activity insert did not return an id");

    const assoc = await server.api(`/api/v1/activities/${activity.id}/association`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout_id: dayA.workout_id }),
    });
    assert.equal(assoc.status, 200, JSON.stringify(assoc.json));

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: dayB.id }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const after = await server.api(`/api/v1/activities/${activity.id}/association`);
    assert.equal(after.status, 200);
    assert.equal((after.json as any).workout_id, dayA.workout_id, "the association must still point at the same logical workout, wherever it now sits");
  } finally {
    await server.close();
  }
});

test("POST .../workouts/swap: rejects a cross-instance swap and leaves both instances' days untouched", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);

    const other = await setUp(server);
    const foreignDay = other.days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.ok(dayA && foreignDay);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: foreignDay.id }),
    });
    assert.equal(res.status, 404, JSON.stringify(res.json));

    const stillA = await server.db.get<{ workout_id: string }>("SELECT workout_id FROM plan_instance_days WHERE id=$1", [dayA.id]);
    const stillForeign = await server.db.get<{ workout_id: string }>("SELECT workout_id FROM plan_instance_days WHERE id=$1", [foreignDay.id]);
    assert.equal(stillA?.workout_id, dayA.workout_id, "the transaction must roll back completely — dayA untouched");
    assert.equal(stillForeign?.workout_id, foreignDay.workout_id, "the transaction must roll back completely — the other instance's day untouched");
  } finally {
    await server.close();
  }
});

test("POST .../workouts/swap: rejects a missing slot and leaves the valid slot untouched", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.ok(dayA);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: 999999999 }),
    });
    assert.equal(res.status, 404, JSON.stringify(res.json));

    const stillA = await server.db.get<{ workout_id: string }>("SELECT workout_id FROM plan_instance_days WHERE id=$1", [dayA.id]);
    assert.equal(stillA?.workout_id, dayA.workout_id, "the transaction must roll back completely — dayA untouched");
  } finally {
    await server.close();
  }
});

test("POST .../workouts/swap: rejects swapping a slot with itself", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.ok(dayA);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/workouts/swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_a_id: dayA.id, day_b_id: dayA.id }),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST .../regenerate: an unmoved slot (same section/week/day) keeps its previous workout_id after regenerating", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const target = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: "2026-09-01" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = (res.json as any).days as any[];
    const afterTarget = after.find(d => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    assert.equal(afterTarget.workout_id, target.workout_id, "regenerating the same slot from the same template must preserve its identity");
  } finally {
    await server.close();
  }
});

// Reconstructs a day's raw D-line the same shape the bulk PATCH/instantiate
// preview accepts — this fixture only ever uses plain continuous runs, so a
// minimal "D<n>: <km>km @ RG" is enough; segments carry resolved_pace, not
// the raw distance, so distance is re-derived from the (deterministic) target.
function reconstructDsl(day: any): string {
  const segments = typeof day.segments === "string" ? JSON.parse(day.segments) : day.segments;
  const segment = segments[0];
  const km = segment.target.distance_m / 1000;
  return `D${day.day}: ${km}km @ RG`;
}
