/**
 * test/http/export-allowance.test.ts (HRA-391)
 * The registered-user FIT export allowance: rolling-window credits spent by
 * the metered POST .../days/:dayId/fit (single) and POST .../fit (week /
 * legacy section) actions, GET /api/v1/export-allowance's authoritative
 * status, the founder's exemption, atomic concurrency-safe consumption, and
 * per-owner isolation. Generation correctness itself (zip contents, FIT
 * decoding) is covered by plan-instance-day-fit.test.ts and
 * plan-instance-scope-fit.test.ts — this file only asserts allowance
 * accounting and the HTTP contract around it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const ONE_WEEK_DSL = `PLAN
NAME One Week Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-01
D1: 5km @ RG
D2: REST
D3: 5km @ RG
D4: REST
D5: 5km @ RG
D6: REST
D7: REST
`;

const TWO_WEEK_DSL = `PLAN
NAME Two Week Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 2
WEEK 1 START 2026-09-01
D1: 5km @ RG
D2: REST
WEEK 2
D1: 6km @ RG
D2: REST
`;

async function createInstance(
  server: Awaited<ReturnType<typeof startTestServer>>,
  cookie: string,
  name: string,
  dsl = ONE_WEEK_DSL,
) {
  const headers = { cookie, "Content-Type": "application/json" };
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers, body: JSON.stringify({ name: `${name} template`, event: "marathon", dsl_source: dsl }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const inst = await server.api(`/api/v1/plan-templates/${(t.json as any).id}/instantiate`, {
    method: "POST", headers, body: JSON.stringify({ name, start_date: "2026-09-01" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { instanceId: (inst.json as any).id as number, days: (inst.json as any).days as any[] };
}

function runDayIds(days: any[]): number[] {
  return days.filter(d => d.workout_type === "run").map(d => d.id as number);
}

test("GET /api/v1/export-allowance reports the founder as unlimited", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/export-allowance");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { unlimited: true, next_credit_at: null, costs: { single: 1, week: 7 } });
  } finally {
    await server.close();
  }
});

test("a fresh registered user starts with the full 7-credit allowance and no next_credit_at", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("fresh-user");
    const res = await server.api("/api/v1/export-allowance", { headers: { cookie } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json, { unlimited: false, limit: 7, remaining: 7, next_credit_at: null, costs: { single: 1, week: 7 } });
  } finally {
    await server.close();
  }
});

test("seven successful single exports exhaust a normal user's allowance; the eighth is rejected", async () => {
  const server = await startTestServer();
  try {
    const { cookie, userId } = await server.loginAs("single-exhaust");
    const { instanceId, days } = await createInstance(server, cookie, "Single Exhaust Instance");
    const [dayId] = runDayIds(days);
    const headers = { cookie };

    for (let i = 0; i < 7; i++) {
      const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers });
      assert.equal(res.status, 200, `export ${i + 1} should succeed: ${JSON.stringify(res.json)}`);
    }

    const status = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((status.json as any).unlimited, false);
    assert.equal((status.json as any).limit, 7);
    assert.equal((status.json as any).remaining, 0);
    assert.ok((status.json as any).next_credit_at, "next_credit_at should be set once credits are spent");

    const eighth = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers });
    assert.equal(eighth.status, 429, JSON.stringify(eighth.json));
    assert.equal((eighth.json as any).allowance.remaining, 0);
    assert.equal((eighth.json as any).allowance.required, 1);
    assert.ok((eighth.json as any).allowance.next_credit_at);

    const count = await server.db.get<{ count: number }>(
      "SELECT COUNT(*)::int count FROM export_allowance_usage WHERE user_id=$1", [userId],
    );
    assert.equal(count?.count, 7);
  } finally {
    await server.close();
  }
});

test("one successful week export exhausts a normal user's allowance", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("week-exhaust");
    const { instanceId } = await createInstance(server, cookie, "Week Exhaust Instance");
    const headers = { cookie };

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base&week_number=1`, { method: "POST", headers });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const status = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((status.json as any).remaining, 0);
  } finally {
    await server.close();
  }
});

test("after one single export, six credits remain and week export is unavailable", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("six-remaining");
    const { instanceId, days } = await createInstance(server, cookie, "Six Remaining Instance");
    const [dayId] = runDayIds(days);
    const headers = { cookie };

    const single = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers });
    assert.equal(single.status, 200, JSON.stringify(single.json));

    const status = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((status.json as any).remaining, 6);

    // Week export costs exactly 7 — 6 remaining must reject it, before
    // generation, consuming nothing further.
    const week = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base&week_number=1`, { method: "POST", headers });
    assert.equal(week.status, 429, JSON.stringify(week.json));
    assert.deepEqual((week.json as any).allowance.remaining, 6);
    assert.deepEqual((week.json as any).allowance.required, 7);

    const statusAfter = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((statusAfter.json as any).remaining, 6, "the rejected week export must not have consumed anything further");
  } finally {
    await server.close();
  }
});

test("a failed single export (needs_review) consumes zero credits", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("failure-path");
    const { instanceId, days } = await createInstance(server, cookie, "Failure Path Instance");
    const [dayId] = runDayIds(days);
    const headers = { cookie };

    await server.db.run(
      "UPDATE plan_instance_workouts w SET needs_review = true FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1",
      [dayId],
    );

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers });
    assert.equal(res.status, 422, JSON.stringify(res.json));

    const status = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((status.json as any).remaining, 7, "a 422 generation failure must not spend a credit");
  } finally {
    await server.close();
  }
});

test("concurrent single-export requests cannot overspend the configured allowance", async () => {
  const server = await startTestServer();
  try {
    const { cookie, userId } = await server.loginAs("concurrent-user");
    const { instanceId, days } = await createInstance(server, cookie, "Concurrent Instance");
    const [dayId] = runDayIds(days);
    const headers = { cookie };

    const results = await Promise.all(
      Array.from({ length: 10 }, () => server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers })),
    );
    const succeeded = results.filter(r => r.status === 200);
    const rejected = results.filter(r => r.status === 429);
    assert.equal(succeeded.length, 7, JSON.stringify(results.map(r => r.status)));
    assert.equal(rejected.length, 3);

    const count = await server.db.get<{ count: number }>(
      "SELECT COUNT(*)::int count FROM export_allowance_usage WHERE user_id=$1", [userId],
    );
    assert.equal(count?.count, 7, "exactly 7 usage rows must exist — no double-spend under concurrency");
  } finally {
    await server.close();
  }
});

test("two normal users have isolated export allowance usage", async () => {
  const server = await startTestServer();
  try {
    const a = await server.loginAs("isolation-user-a");
    const b = await server.loginAs("isolation-user-b");
    const { instanceId: instanceA, days: daysA } = await createInstance(server, a.cookie, "Isolation Instance A");
    const { instanceId: instanceB, days: daysB } = await createInstance(server, b.cookie, "Isolation Instance B");

    // Exhaust A's allowance entirely.
    const [dayIdA] = runDayIds(daysA);
    for (let i = 0; i < 7; i++) {
      const res = await server.api(`/api/v1/plan-instances/${instanceA}/days/${dayIdA}/fit`, { method: "POST", headers: { cookie: a.cookie } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
    }
    const exhaustedA = await server.api(`/api/v1/plan-instances/${instanceA}/days/${dayIdA}/fit`, { method: "POST", headers: { cookie: a.cookie } });
    assert.equal(exhaustedA.status, 429);

    // B is untouched.
    const statusB = await server.api("/api/v1/export-allowance", { headers: { cookie: b.cookie } });
    assert.deepEqual(statusB.json, { unlimited: false, limit: 7, remaining: 7, next_credit_at: null, costs: { single: 1, week: 7 } });
    const [dayIdB] = runDayIds(daysB);
    const exportB = await server.api(`/api/v1/plan-instances/${instanceB}/days/${dayIdB}/fit`, { method: "POST", headers: { cookie: b.cookie } });
    assert.equal(exportB.status, 200, JSON.stringify(exportB.json));
  } finally {
    await server.close();
  }
});

test("guest/anonymous cannot call any metered export action or read allowance state", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("guest-baseline-owner");
    const { instanceId, days } = await createInstance(server, cookie, "Guest Baseline Instance");
    const [dayId] = runDayIds(days);

    const day = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST", headers: { cookie: "" } });
    assert.equal(day.status, 401, JSON.stringify(day.json));
    const week = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base&week_number=1`, { method: "POST", headers: { cookie: "" } });
    assert.equal(week.status, 401, JSON.stringify(week.json));
    const status = await server.api("/api/v1/export-allowance", { headers: { cookie: "" } });
    assert.equal(status.status, 401, JSON.stringify(status.json));
  } finally {
    await server.close();
  }
});

test("a retained whole-section export charges 7 credits per distinct plan week represented and cannot bypass the weighted policy", async () => {
  const server = await startTestServer();
  try {
    const { cookie } = await server.loginAs("section-pricing");
    const { instanceId } = await createInstance(server, cookie, "Section Pricing Instance", TWO_WEEK_DSL);
    const headers = { cookie };

    // The whole section spans 2 distinct weeks -> 14 credits required, but a
    // fresh user only has 7 — must reject exactly like the metered week
    // action would, not silently succeed at a discount.
    const whole = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base`, { method: "POST", headers });
    assert.equal(whole.status, 429, JSON.stringify(whole.json));
    assert.equal((whole.json as any).allowance.required, 14);
    assert.equal((whole.json as any).allowance.remaining, 7);

    const statusAfter = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((statusAfter.json as any).remaining, 7, "the rejected whole-section export must consume nothing");

    // A single week within that same section costs exactly 7 (matches the
    // metered week action's own rate) and succeeds with the full balance.
    const oneWeek = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base&week_number=1`, { method: "POST", headers });
    assert.equal(oneWeek.status, 200, JSON.stringify(oneWeek.json));
    const statusFinal = await server.api("/api/v1/export-allowance", { headers });
    assert.equal((statusFinal.json as any).remaining, 0);
  } finally {
    await server.close();
  }
});

test("the founder can export beyond the normal limit without consuming credits", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await createInstance(server, server.sessionCookie, "Founder Unlimited Instance");
    const [dayId] = runDayIds(days);

    for (let i = 0; i < 10; i++) {
      const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}/fit`, { method: "POST" });
      assert.equal(res.status, 200, `founder export ${i + 1} should succeed: ${JSON.stringify(res.json)}`);
    }

    const status = await server.api("/api/v1/export-allowance");
    assert.deepEqual(status.json, { unlimited: true, next_credit_at: null, costs: { single: 1, week: 7 } });

    const founderUsage = await server.db.get<{ count: number }>(
      "SELECT COUNT(*)::int count FROM export_allowance_usage WHERE user_id=$1", ["00000000-0000-4000-8000-000000000001"],
    );
    assert.equal(founderUsage?.count, 0, "the founder must never create allowance-consumption records");
  } finally {
    await server.close();
  }
});
