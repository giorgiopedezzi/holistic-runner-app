/**
 * test/http/plan-instances-patch.test.ts (HRA-135)
 * PATCH /api/v1/plan-instances/:id — replaces the earlier PUT. Body is
 * {name?, race_name?, race_date?, race_url?, days?}, all optional but at
 * least one required; each provided field replaces its current value, every
 * omitted field is left untouched. `days`, when provided, still fully
 * replaces the day set (unchanged semantics from the old PUT).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PLAN
NAME Smoke Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-01
D1: 5km @ RG
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Patch fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  const templateId = (t.json as any).id as number;

  const inst = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Original name", start_date: "2026-09-01",
      race_name: "Original Race", race_date: "2026-10-01", race_url: "https://example.com/original",
    }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  return { templateId, instanceId: (inst.json as any).id as number, days: (inst.json as any).days as any[] };
}

async function patch(server: Awaited<ReturnType<typeof startTestServer>>, id: number, body: unknown) {
  return server.api(`/api/v1/plan-instances/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

test("PATCH .../plan-instances/:id updates only the provided field, leaves the rest untouched", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);

    const res = await patch(server, instanceId, { name: "Renamed" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    assert.equal(updated.name, "Renamed");
    // Untouched fields keep their original value.
    assert.equal(updated.race_name, "Original Race");
    assert.equal(updated.race_date, "2026-10-01");
    assert.equal(updated.race_url, "https://example.com/original");
    assert.equal(updated.days.length, 7, "days were not provided, so the day set is untouched");
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id can update race fields independently of name", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);

    const res = await patch(server, instanceId, { race_name: "New Race", race_date: "2026-11-15" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    assert.equal(updated.name, "Original name", "name untouched");
    assert.equal(updated.race_name, "New Race");
    assert.equal(updated.race_date, "2026-11-15");
    assert.equal(updated.race_url, "https://example.com/original", "race_url untouched");
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id clears a race field via explicit null", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);

    const res = await patch(server, instanceId, { race_url: null });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    assert.equal(updated.race_url, null);
    assert.equal(updated.race_name, "Original Race", "untouched fields stay as they were");
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id with days fully replaces the day set", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, days } = await setUp(server);
    assert.equal(days.length, 7);
    const originalD1 = days.find(d => d.date === "2026-09-01");

    const res = await patch(server, instanceId, {
      days: [{ section_name: "Base", week_number: 1, date: "2026-09-01", dsl: "D1: 8km @ RG" }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const updated = res.json as any;
    assert.equal(updated.days.length, 1, "the full day set was replaced by the single supplied day");
    assert.notEqual(updated.days[0].id, originalD1.id, "old day row was deleted and reinserted");
    assert.equal(updated.name, "Original name", "name untouched when only days is supplied");
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id clears approved_at whenever any field is applied", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);

    const approved = await server.api(`/api/v1/plan-instances/${instanceId}/approve`, { method: "POST" });
    assert.equal(approved.status, 200);
    assert.ok((approved.json as any).approved_at, "fixture must actually be approved before this assertion is meaningful");

    const res = await patch(server, instanceId, { race_name: "Renamed race" });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).approved_at, null);
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id rejects an empty body", async () => {
  const server = await startTestServer();
  try {
    const { instanceId } = await setUp(server);
    const res = await patch(server, instanceId, {});
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("PATCH .../plan-instances/:id 404s for an unknown instance", async () => {
  const server = await startTestServer();
  try {
    const res = await patch(server, 999999, { name: "Whatever" });
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
