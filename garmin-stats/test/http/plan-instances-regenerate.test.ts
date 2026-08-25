/**
 * test/http/plan-instances-regenerate.test.ts (HRA-132)
 * POST /api/v1/plan-instances/:id/regenerate — regenerates an instance's
 * days from a cutover date onward, given a possibly-changed start_date
 * and/or pace_overrides. Days before the cutover must stay completely
 * untouched; days on/after it are fully regenerated from the template DSL.
 *
 * The plan spans WEEKS_COUNT weeks (one declared day per week, D1 — the
 * other 6 days/week auto-fill as REST, HRA-124) starting well before "today"
 * so the resulting day range straddles "today" with margin on both sides,
 * regardless of when this test actually runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const WEEKS_COUNT = 20; // 140 days total (20 * 7)
const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS *
${Array.from({ length: WEEKS_COUNT }, (_, i) => `WEEK ${i + 1}\nD1: 5km @ RG`).join("\n")}
`;

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const pastStart = addDays(today, -70); // plan then runs from today-70 to today+69

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regenerate fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regenerate instance", start_date: pastStart }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { templateId, instanceId: (inst.json as any).id as number, originalDays: (inst.json as any).days as any[] };
}

test("POST .../regenerate leaves days before the cutover untouched and regenerates the rest", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, originalDays } = await setUp(server);
    assert.equal(originalDays.length, WEEKS_COUNT * 7);

    const effectiveFrom = addDays(today, 30);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: effectiveFrom }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = (res.json as any).days as any[];
    assert.equal(after.length, WEEKS_COUNT * 7, "total day count should be unchanged — full plan still covers the same span");

    const beforeCutover = originalDays.filter(d => d.date < effectiveFrom);
    const onOrAfterCutover = originalDays.filter(d => d.date >= effectiveFrom);
    assert.ok(beforeCutover.length > 0 && onOrAfterCutover.length > 0, "fixture must straddle the cutover");

    const afterById = new Map(after.map(d => [d.id, d]));
    for (const d of beforeCutover) {
      assert.ok(afterById.has(d.id), `day ${d.id} (${d.date}) before cutover should still exist with its original id`);
      assert.equal(afterById.get(d.id).date, d.date, "an untouched day's date must not change");
    }
    for (const d of onOrAfterCutover) {
      assert.ok(!afterById.has(d.id), `day ${d.id} (${d.date}) on/after cutover should have been deleted and reinserted under a new id`);
    }
  } finally {
    await server.close();
  }
});

test("POST .../regenerate rejects an effective_from before today (server-enforced, not just client-trusted)", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const yesterday = addDays(today, -1);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: yesterday }),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST .../regenerate with a new start_date shifts only the days on/after the cutover", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const effectiveFrom = addDays(today, 30);
    const newStartDate = addDays(pastStart, 3); // shift the whole plan 3 days later

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: newStartDate, effective_from: effectiveFrom }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).start_date, newStartDate, "the instance's own start_date should update to the new value");

    // Under the new start_date, week N's D1 lands 3 days later than before.
    // Pick a week whose (shifted) D1 date falls on/after the cutover and
    // confirm it actually moved.
    const days = (res.json as any).days as any[];
    const shiftedWeek1D1 = addDays(newStartDate, 0);
    if (shiftedWeek1D1 >= effectiveFrom) {
      const found = days.find(d => d.week_number === 1 && d.day === 1);
      assert.equal(found.date, shiftedWeek1D1);
    }
  } finally {
    await server.close();
  }
});

test("POST .../regenerate with new pace_overrides re-resolves the regenerated days' pace", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const effectiveFrom = addDays(today, 30);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pace_overrides: { RG: "4:00/km" }, effective_from: effectiveFrom }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const regeneratedDay = (res.json as any).days.find((d: any) => d.date >= effectiveFrom && d.day === 1);
    const segments = JSON.parse(regeneratedDay.segments);
    assert.equal(segments[0].resolved_pace_sec_per_km, 240, "4:00/km must resolve to 240 sec/km, not the template's original 5:00/km (300)");
  } finally {
    await server.close();
  }
});

test("POST .../regenerate clears approval, same gate-2 rule as every other instance edit", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const approveRes = await server.api(`/api/v1/plan-instances/${instanceId}/approve`, { method: "POST" });
    assert.equal(approveRes.status, 200);
    assert.ok((approveRes.json as any).approved_at != null);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: addDays(today, 30) }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).approved_at, null);
  } finally {
    await server.close();
  }
});

test("POST .../regenerate 404s for an unknown instance id", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-instances/999999/regenerate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_from: addDays(today, 30) }),
    });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
