/**
 * test/http/plan-instances-workout-id.test.ts (HRA-333)
 * Every plan_instance_days row's stable workout_id — assigned at
 * instantiation, and carried across the mutation paths that must preserve a
 * planned workout's identity independent of its placement: the bulk
 * days-replace (PATCH /plan-instances/:id), the single-day PATCH
 * (.../days/:dayId, the swap flows' own persistence path), and regenerate.
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

test("PATCH .../days/:dayId: a swap flow's own two-call persistence moves workout_id with the swapped-in dsl", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const dayA = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 1);
    const dayB = days.find((d: any) => d.section_name === "Base" && d.week_number === 1 && d.day === 3);
    assert.ok(dayA && dayB);

    const resA = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayA.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dsl: reconstructDsl({ ...dayB, day: dayA.day }), workout_id: dayB.workout_id }),
    });
    assert.equal(resA.status, 200, JSON.stringify(resA.json));
    assert.equal((resA.json as any).workout_id, dayB.workout_id, "row A now holds B's content, so it must carry B's workout_id");

    const resB = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayB.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dsl: reconstructDsl({ ...dayA, day: dayB.day }), workout_id: dayA.workout_id }),
    });
    assert.equal(resB.status, 200, JSON.stringify(resB.json));
    assert.equal((resB.json as any).workout_id, dayA.workout_id, "row B now holds A's content, so it must carry A's workout_id");
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
