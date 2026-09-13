/**
 * test/http/plan-instances-revision.test.ts (HRA-336)
 * The minimal durable plan-revision contract: current_revision increments
 * exactly once per successful semantic mutation of Current, never for a
 * no-op; original_revision follows it pre-freeze and then holds forever.
 * Dates are computed relative to "today" so the tests are stable regardless
 * of when they run — same convention as plan-instances-timezone.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

// Every day is declared explicitly (no auto-filled rest days, HRA-124) so a
// resend of the exact same dsl text reparses to the exact same segments —
// an auto-filled rest day's synthetic segment (carrying DEFAULT_REST's
// rest_type) can never be reproduced by re-submitting explicit "REST" dsl
// text through the bulk PATCH path, which is a real (pre-existing, out of
// scope for this Story) difference, not a no-op-detection bug.
const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
D2: REST
D3: REST
D4: REST
D5: REST
D6: REST
D7: REST
`;

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const futureStart = addDays(today, 30); // pre-freeze
const pastStart = addDays(today, -10);  // frozen from creation onward

async function createTemplate(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Revision fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  return (t.json as any).id as number;
}

async function instantiate(server: Awaited<ReturnType<typeof startTestServer>>, templateId: number, body: Record<string, unknown> = {}) {
  return server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Revision instance", start_date: futureStart, schedule_timezone: "Europe/Rome", ...body }),
  });
}

test("instantiate: current_revision and original_revision both start at 1", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 1);
    assert.equal((res.json as any).original_revision, 1);
  } finally {
    await server.close();
  }
});

test("PATCH days: a real content change bumps current_revision by exactly 1, and original_revision follows (pre-freeze)", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ section_name: "Base", week_number: 1, date: futureStart, dsl: "D1: 8km @ RG" }] }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 2);
    assert.equal((res.json as any).original_revision, 2, "pre-freeze: original_revision follows current_revision");
  } finally {
    await server.close();
  }
});

test("PATCH days: resending byte-identical days is a no-op — current_revision stays at 1", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;
    // The template only declares D1; week 1's remaining D2-D7 are auto-filled
    // rest days (docs/schema.md) — reconstruct EVERY day's own dsl so this
    // really is a byte-identical re-save, not an accidental content change.
    const days = (created.json as any).days as { section_name: string; week_number: number; date: string; day: number; workout_type: string; workout_id: string }[];
    const dslFor = (d: { day: number; workout_type: string }) => d.workout_type === "rest" ? `D${d.day}: REST` : `D${d.day}: 5km @ RG`;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: days.map(d => ({ section_name: d.section_name, week_number: d.week_number, date: d.date, dsl: dslFor(d), workout_id: d.workout_id })) }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 1, "identical re-save must not bump the revision");
  } finally {
    await server.close();
  }
});

test("PATCH fields-only (name): bumps current_revision", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Renamed" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 2);
  } finally {
    await server.close();
  }
});

test("PATCH fields-only: resending the exact same name is a no-op", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { name: "Same Name" });
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Same Name" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 1);
  } finally {
    await server.close();
  }
});

test("PATCH one day: a real notes change bumps current_revision; resending the same notes is a no-op", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;
    const dayId = (created.json as any).days[0].id as number;

    const first = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "swapped shoes" }),
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const afterFirst = await server.api(`/api/v1/plan-instances/${instanceId}`);
    assert.equal((afterFirst.json as any).current_revision, 2);

    const second = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "swapped shoes" }),
    });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    const afterSecond = await server.api(`/api/v1/plan-instances/${instanceId}`);
    assert.equal((afterSecond.json as any).current_revision, 2, "resending the same notes must not bump again");
  } finally {
    await server.close();
  }
});

test("regenerate: a real change (different start_date) bumps current_revision by exactly 1", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;
    const laterStart = addDays(futureStart, 7);
    const effectiveFrom = addDays(today, 1);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: laterStart, effective_from: effectiveFrom }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 2);
  } finally {
    await server.close();
  }
});

test("regenerate: identical start_date against an unchanged template is a no-op", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId);
    const instanceId = (created.json as any).id as number;
    const effectiveFrom = addDays(today, 1);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: futureStart, effective_from: effectiveFrom }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).current_revision, 1, "regenerating to the exact same result must not bump");
  } finally {
    await server.close();
  }
});

test("post-freeze: original_revision holds forever while current_revision keeps incrementing across further edits", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { start_date: pastStart });
    const instanceId = (created.json as any).id as number;

    const frozen = await server.api(`/api/v1/plan-instances/${instanceId}`);
    assert.equal((frozen.json as any).current_revision, 1);
    assert.equal((frozen.json as any).original_revision, 1);

    const first = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Post-freeze edit 1" }),
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal((first.json as any).current_revision, 2);
    assert.equal((first.json as any).original_revision, 1, "frozen — never follows current_revision again");

    const second = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Post-freeze edit 2" }),
    });
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal((second.json as any).current_revision, 3);
    assert.equal((second.json as any).original_revision, 1);
  } finally {
    await server.close();
  }
});
