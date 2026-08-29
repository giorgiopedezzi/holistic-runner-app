/**
 * test/http/plan-instance-scope-fit.test.ts (HRA-203)
 * GET /api/v1/plan-instances/:id/fit?section_name=&week_number= — bundles
 * every exportable day in a section (or one week within it) into a single
 * uncompressed ZIP. Verifies both the HTTP contract (status/headers/skip
 * counts) and that the returned bytes are a real ZIP whose entries decode
 * back to the expected FIT steps — via a real external unzip tool, not just
 * this repo's own writer/reader, mirroring domain/zip-writer.test.ts's own
 * "don't just round-trip through your own code" verification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "../helpers/server.ts";
import { fromGarminWorkoutFit } from "../../src/integrations/garmin-workout.ts";

const DSL = `PLAN
NAME Smoke Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 2
WEEK 1 START 2026-09-01
D1: 5km @ RG
D2: REST
D3: 6km @ RG
WEEK 2
D1: 7km @ RG
D2: REST
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>, instanceName = "Zip Export Instance") {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Zip export fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));

  const inst = await server.api(`/api/v1/plan-templates/${(t.json as any).id}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: instanceName, start_date: "2026-09-01" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { instanceId: (inst.json as any).id as number, days: (inst.json as any).days as any[] };
}

async function fetchZip(server: Awaited<ReturnType<typeof startTestServer>>, path: string) {
  const res = await fetch(`${server.baseUrl}${path}`);
  return { res, bytes: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}

function extractAndDecode(zipBytes: Buffer): Record<string, ReturnType<typeof fromGarminWorkoutFit>> {
  const dir = mkdtempSync(join(tmpdir(), "hra203-scope-fit-"));
  try {
    writeFileSync(join(dir, "plan.zip"), zipBytes);
    execFileSync("unzip", ["-o", "plan.zip"], { cwd: dir });
    const names = readdirSync(dir).filter(f => f !== "plan.zip");
    const decoded: Record<string, ReturnType<typeof fromGarminWorkoutFit>> = {};
    for (const name of names) {
      decoded[name] = fromGarminWorkoutFit(execFileSync("unzip", ["-p", "plan.zip", name], { cwd: dir }));
    }
    return decoded;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Both weeks in the fixture DSL declare only some of D1-D7 (WEEK 1: D1/D2/D3,
// WEEK 2: D1/D2) — HRA-124 auto-fills every undeclared D-number 1-7 as a rest
// day, so each week actually resolves to 7 days (14 for the whole section),
// not just the lines the DSL text spells out. Assertions below check counts
// and a couple of representative filenames rather than every one of the 14,
// so they don't depend on re-deriving the full rest-day-autofill date math.
test("GET .../fit?section_name= downloads a zip with one .fit per exportable day in the section", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server, "Zip Export Instance");
    const { res, bytes } = await fetchZip(server, `/api/v1/plan-instances/${instanceId}/fit?section_name=Base`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="Zip Export Instance_20260901-20260914.zip"');
    assert.equal(res.headers.get("x-export-total"), "14");
    assert.equal(res.headers.get("x-export-included"), "14");
    assert.equal(res.headers.get("x-export-skipped"), "0");

    const decoded = extractAndDecode(bytes!);
    const names = Object.keys(decoded);
    assert.equal(names.length, 14);
    assert.ok(names.includes("Zip Export Instance_20260901.fit"));
    assert.ok(names.includes("Zip Export Instance_20260914.fit"));
    for (const outcome of Object.values(decoded)) assert.equal(outcome.ok, true, JSON.stringify(outcome));
  } finally {
    await server.close();
  }
});

test("GET .../fit?section_name=&week_number= scopes the zip to one week only", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server, "Week Scope Instance");
    const { res, bytes } = await fetchZip(server, `/api/v1/plan-instances/${instanceId}/fit?section_name=Base&week_number=2`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-export-total"), "7");
    assert.equal(res.headers.get("x-export-included"), "7");

    const decoded = extractAndDecode(bytes!);
    const names = Object.keys(decoded);
    assert.equal(names.length, 7);
    assert.ok(names.every(n => !n.includes("20260901") && !n.includes("20260907")), "week 2 must not include week 1's dates");
    assert.ok(names.includes("Week Scope Instance_20260908.fit"));
    assert.ok(names.includes("Week Scope Instance_20260914.fit"));
  } finally {
    await server.close();
  }
});

test("GET .../fit skips a needs_review day and reports it, downloading the rest", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    const flagged = days.find((d: any) => d.date === "2026-09-01");
    server.db.prepare("UPDATE plan_instance_days SET needs_review = 1 WHERE id = ?").run(flagged.id);

    const { res, bytes } = await fetchZip(server, `/api/v1/plan-instances/${instanceId}/fit?section_name=Base`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-export-total"), "14");
    assert.equal(res.headers.get("x-export-included"), "13");
    assert.equal(res.headers.get("x-export-skipped"), "1");

    const decoded = extractAndDecode(bytes!);
    assert.equal(Object.keys(decoded).length, 13);
    assert.ok(!Object.keys(decoded).some(name => name.includes("20260901")));
  } finally {
    await server.close();
  }
});

test("GET .../fit 422s and downloads nothing when every day in scope is non-exportable", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    server.db.prepare("UPDATE plan_instance_days SET needs_review = 1 WHERE instance_id = ?").run(instanceId);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=Base`);
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("GET .../fit 422s when section_name matches no days at all", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/fit?section_name=NoSuchSection`);
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("GET .../fit 400s when section_name is missing", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceId}/fit`);
    assert.equal(res.status, 400, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("GET .../fit 404s for an unknown instance", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-instances/999999/fit?section_name=Base");
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
