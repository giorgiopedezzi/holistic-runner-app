/**
 * test/http/plan-instances-approve.test.ts (HRA-249)
 * POST /api/v1/plan-instances/:id/approve — blocks activation when the
 * candidate's resolved date range overlaps an already-approved instance's
 * own range, inclusively and date-only (start/end boundary, full
 * containment either direction, shared boundary date). Reuses the
 * auto-REST-fill behavior (HRA-124: one declared D-line per week fills the
 * other 6 days of that week as REST) so a template with N weeks and a
 * single D1 line per week resolves to a clean, predictable N*7-day range
 * from its start_date — no need to hand-author every day.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

function planDsl(name: string, weeks: number): string {
  const weekBlocks = Array.from({ length: weeks }, (_, i) => `WEEK ${i + 1}\nD1: 5km @ RG`).join("\n");
  return `PLAN\nNAME ${name}\nPACE RG=5:00/km\nSECTION "Base" WEEKS ${weeks}\n${weekBlocks}\n`;
}

async function createInstance(
  server: Awaited<ReturnType<typeof startTestServer>>,
  opts: { name: string; weeks: number; startDate: string },
): Promise<number> {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `${opts.name} template`, event: "marathon", dsl_source: planDsl(opts.name, opts.weeks) }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));

  const inst = await server.api(`/api/v1/plan-templates/${(t.json as any).id}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: opts.name, start_date: opts.startDate }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return (inst.json as any).id as number;
}

function approve(server: Awaited<ReturnType<typeof startTestServer>>, id: number) {
  return server.api(`/api/v1/plan-instances/${id}/approve`, { method: "POST" });
}

test("approve: no overlap (B ends before A starts) succeeds", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-10" }); // 09-10..09-16
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 200, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: no overlap (B starts right after A ends) succeeds", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-09-08" }); // 09-08..09-14
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 200, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: start-boundary overlap (shared boundary date) is rejected with 409, approved_at unset", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-09-07" }); // 09-07..09-13
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 409, JSON.stringify(res.json));
    const body = res.json as any;
    assert.equal(body.overlaps.candidate.id, b);
    assert.equal(body.overlaps.conflicts.length, 1);
    assert.equal(body.overlaps.conflicts[0].id, a);
    assert.equal(body.overlaps.conflicts[0].overlap_start, "2026-09-07");
    assert.equal(body.overlaps.conflicts[0].overlap_end, "2026-09-07");

    const check = await server.api(`/api/v1/plan-instances/${b}`);
    assert.equal((check.json as any).approved_at, null);
  } finally {
    await server.close();
  }
});

test("approve: end-boundary overlap is rejected with 409", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-08-26" }); // 08-26..09-01
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 409, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: full containment (B fully inside A) is rejected with 409", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 3, startDate: "2026-09-01" }); // 09-01..09-21
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-09-05" }); // 09-05..09-11
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 409, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: full containment (A fully inside B — reverse direction) is rejected with 409", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-05" }); // 09-05..09-11
    const b = await createInstance(server, { name: "B", weeks: 3, startDate: "2026-09-01" }); // 09-01..09-21
    assert.equal((await approve(server, a)).status, 200);
    const res = await approve(server, b);
    assert.equal(res.status, 409, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: re-approving an already-approved instance never conflicts with itself", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" });
    assert.equal((await approve(server, a)).status, 200);
    const again = await approve(server, a);
    assert.equal(again.status, 200, JSON.stringify(again.json));
  } finally {
    await server.close();
  }
});

test("approve: an overlapping but never-approved instance is ignored", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    const b = await createInstance(server, { name: "B", weeks: 1, startDate: "2026-09-04" }); // overlaps A, never approved
    const res = await approve(server, a); // A is the one being approved; B (unapproved) must not block it
    assert.equal(res.status, 200, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("approve: multiple simultaneous conflicts are all listed, not just the first", async () => {
  const server = await startTestServer();
  try {
    const a = await createInstance(server, { name: "A", weeks: 1, startDate: "2026-09-01" }); // 09-01..09-07
    const c = await createInstance(server, { name: "C", weeks: 1, startDate: "2026-09-15" }); // 09-15..09-21
    const d = await createInstance(server, { name: "D", weeks: 3, startDate: "2026-09-01" }); // 09-01..09-21, overlaps both
    assert.equal((await approve(server, a)).status, 200);
    assert.equal((await approve(server, c)).status, 200);

    const res = await approve(server, d);
    assert.equal(res.status, 409, JSON.stringify(res.json));
    const ids = (res.json as any).overlaps.conflicts.map((x: any) => x.id).sort();
    assert.deepEqual(ids, [a, c].sort());
  } finally {
    await server.close();
  }
});
