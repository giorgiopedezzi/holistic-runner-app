/**
 * test/http/demo-mode.test.ts  (HRA-220)
 * DEMO_MODE gate: gated write endpoints reject with 403 when it's on, every
 * carve-out (plan template create/update, saved date-range create/update)
 * still works, and nothing changes at all when it's off (the default).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "../helpers/server.ts";

async function withServer(fn: (s: TestServer) => Promise<void>, opts: { seed?: boolean; demoMode?: boolean } = { seed: true }) {
  const s = await startTestServer(opts);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
});

const DSL = `PACE RG=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`;

test("DEMO_MODE=true: activity rename/delete are rejected with 403 problem+json", async () => {
  await withServer(async (s) => {
    const { data: [a] } = (await s.api("/api/v1/activities?from=2026-01-01&to=2027-01-01")).json as { data: { id: number }[] };
    const rename = await s.api(`/api/v1/activities/${a.id}/type`, json("PUT", { activity_type_id: 1 }));
    assert.equal(rename.status, 403);
    assert.equal((rename.json as { title: string }).title, "Forbidden");

    const del = await s.api(`/api/v1/activities/${a.id}`, json("DELETE"));
    assert.equal(del.status, 403);

    const delRange = await s.api("/api/v1/activities?from=2026-01-01&to=2027-01-01", json("DELETE"));
    assert.equal(delRange.status, 403);
  }, { seed: true, demoMode: true });
});

test("DEMO_MODE=true: sync triggers and trash restore/purge are rejected with 403", async () => {
  await withServer(async (s) => {
    assert.equal((await s.api("/api/v1/sync/withings", json("POST"))).status, 403);
    assert.equal((await s.api("/api/v1/sync/strava", json("POST"))).status, 403);
    assert.equal((await s.api("/api/v1/activities/restore", json("POST", { ids: [1] }))).status, 403);
    assert.equal((await s.api("/api/v1/activities/purge", json("POST", { ids: [1] }))).status, 403);
    assert.equal((await s.api("/api/v1/body-measurements/restore", json("POST", { ids: [1] }))).status, 403);
    assert.equal((await s.api("/api/v1/body-measurements/purge", json("POST", { ids: [1] }))).status, 403);
    assert.equal((await s.api("/api/v1/body-measurements?from=2026-01-01&to=2027-01-01", json("DELETE"))).status, 403);
  }, { seed: true, demoMode: true });
});

test("DEMO_MODE=true: plan template create + update still work; approve + delete are rejected", async () => {
  await withServer(async (s) => {
    const create = await s.api("/api/v1/plan-templates", json("POST", {
      name: "Demo template", event: "5k", dsl_source: DSL,
    }));
    assert.equal(create.status, 201);
    const id = (create.json as { id: number }).id;

    const update = await s.api(`/api/v1/plan-templates/${id}`, json("PUT", {
      name: "Demo template v2", event: "5k", dsl_source: DSL,
    }));
    assert.equal(update.status, 200);

    const approve = await s.api(`/api/v1/plan-templates/${id}/approve`, json("POST"));
    assert.equal(approve.status, 403);

    const remove = await s.api(`/api/v1/plan-templates/${id}`, json("DELETE"));
    assert.equal(remove.status, 403);
  }, { seed: true, demoMode: true });
});

test("DEMO_MODE=true: plan instance instantiate/approve/delete are all rejected", async () => {
  await withServer(async (s) => {
    const instantiate = await s.api("/api/v1/plan-templates/1/instantiate", json("POST", { name: "x", start_date: "2026-01-05" }));
    assert.equal(instantiate.status, 403);
    assert.equal((await s.api("/api/v1/plan-instances/1/approve", json("POST"))).status, 403);
    assert.equal((await s.api("/api/v1/plan-instances/1", json("DELETE"))).status, 403);
  }, { seed: true, demoMode: true });
});

test("DEMO_MODE=true: saved date ranges — create/update still work, delete is rejected", async () => {
  await withServer(async (s) => {
    const create = await s.api("/api/v1/date-ranges", json("POST", { name: "Block A", from: "2026-01-01", to: "2026-01-31" }));
    assert.equal(create.status, 201);
    const id = (create.json as { id: number }).id;

    const update = await s.api(`/api/v1/date-ranges/${id}`, json("PUT", { name: "Block A renamed", from: "2026-01-01", to: "2026-01-31" }));
    assert.equal(update.status, 200);

    const remove = await s.api(`/api/v1/date-ranges/${id}`, json("DELETE"));
    assert.equal(remove.status, 403);
  }, { seed: true, demoMode: true });
});

test("DEMO_MODE unset (default false): every gated endpoint behaves exactly as before", async () => {
  await withServer(async (s) => {
    const { data: [a] } = (await s.api("/api/v1/activities?from=2026-01-01&to=2027-01-01")).json as { data: { id: number }[] };
    const rename = await s.api(`/api/v1/activities/${a.id}/type`, json("PUT", { activity_type_id: 1 }));
    assert.equal(rename.status, 200);

    const del = await s.api(`/api/v1/activities/${a.id}`, json("DELETE"));
    assert.equal(del.status, 200);
  }, { seed: true, demoMode: false });
});

test("GET /api/v1/settings surfaces demo_mode from config, on and off", async () => {
  await withServer(async (s) => {
    const on = (await s.api("/api/v1/settings")).json as { demo_mode: boolean };
    assert.equal(on.demo_mode, true);
  }, { seed: false, demoMode: true });

  await withServer(async (s) => {
    const off = (await s.api("/api/v1/settings")).json as { demo_mode: boolean };
    assert.equal(off.demo_mode, false);
  }, { seed: false, demoMode: false });
});
