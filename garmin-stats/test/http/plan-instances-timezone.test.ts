/**
 * test/http/plan-instances-timezone.test.ts (HRA-332)
 * schedule_timezone defaulting/validation at creation, the Original-baseline
 * freeze boundary, and pre/post-freeze mirroring across the mutation paths
 * (PATCH fields+days, PATCH one day, regenerate). Dates are computed
 * relative to "today" so the tests are stable regardless of when they run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`;

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = new Date().toISOString().slice(0, 10);
const futureStart = addDays(today, 30); // pre-freeze: Original still mirrors Current
const pastStart = addDays(today, -10);  // frozen from creation onward

async function createTemplate(server: Awaited<ReturnType<typeof startTestServer>>) {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "TZ fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));
  return (t.json as any).id as number;
}

async function instantiate(server: Awaited<ReturnType<typeof startTestServer>>, templateId: number, body: Record<string, unknown>) {
  return server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "TZ instance", start_date: futureStart, ...body }),
  });
}

test("instantiate: explicit schedule_timezone wins over the owner profile", async () => {
  const server = await startTestServer();
  try {
    await server.api("/api/v1/settings/timezone", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: "America/New_York" }),
    });
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal((res.json as any).schedule_timezone, "Europe/Rome");
  } finally {
    await server.close();
  }
});

test("instantiate: defaults from the owner-configured settings.timezone when no explicit value is supplied", async () => {
  const server = await startTestServer();
  try {
    await server.api("/api/v1/settings/timezone", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: "America/New_York" }),
    });
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, {});
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal((res.json as any).schedule_timezone, "America/New_York");
  } finally {
    await server.close();
  }
});

test("instantiate: falls back to browser_timezone_fallback when the owner profile has no timezone configured", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, { browser_timezone_fallback: "Asia/Tokyo" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal((res.json as any).schedule_timezone, "Asia/Tokyo");
  } finally {
    await server.close();
  }
});

test("instantiate: falls back to UTC when nothing at all is supplied (non-breaking default for existing callers)", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, {});
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal((res.json as any).schedule_timezone, "UTC");
  } finally {
    await server.close();
  }
});

test("instantiate: rejects an invalid schedule_timezone with 422", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, { schedule_timezone: "Not/AZone" });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("instantiate: Original mirrors Current at creation (start_date + full day snapshot)", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const res = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    const instanceId = (res.json as any).id as number;
    const row = (await server.db.get<{ original_start_date: string; original_days_snapshot: unknown }>("SELECT original_start_date, original_days_snapshot FROM plan_instances WHERE id = $1", [instanceId]))!;
    assert.equal(row.original_start_date, futureStart);
    assert.equal((typeof row.original_days_snapshot === "string" ? JSON.parse(row.original_days_snapshot) : row.original_days_snapshot as unknown[]).length, 7);
  } finally {
    await server.close();
  }
});

test("PATCH schedule_timezone: correctable before the first local plan day (pre-freeze)", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule_timezone: "America/New_York" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal((res.json as any).schedule_timezone, "America/New_York");
  } finally {
    await server.close();
  }
});

test("PATCH schedule_timezone: rejected with 409 once Original has frozen (start_date already in the past)", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome", start_date: pastStart });
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule_timezone: "America/New_York" }),
    });
    assert.equal(res.status, 409, JSON.stringify(res.json));
    const row = (await server.db.get<{ schedule_timezone: string }>("SELECT schedule_timezone FROM plan_instances WHERE id = $1", [instanceId]))!;
    assert.equal(row.schedule_timezone, "Europe/Rome", "the rejected write must not have applied");
  } finally {
    await server.close();
  }
});

test("PATCH schedule_timezone: rejects an invalid identifier with 422", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schedule_timezone: "Nope" }),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("PATCH days: pre-freeze, Original mirrors the replaced day set", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    const instanceId = (created.json as any).id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ section_name: "Base", week_number: 1, date: futureStart, dsl: "D1: 8km @ RG" }] }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const row = (await server.db.get<{ original_days_snapshot: unknown }>("SELECT original_days_snapshot FROM plan_instances WHERE id = $1", [instanceId]))!;
    const snapshot = typeof row.original_days_snapshot === "string" ? JSON.parse(row.original_days_snapshot) : row.original_days_snapshot as any[];
    assert.equal(snapshot.length, 1, "Original was re-mirrored to the just-replaced (single-day) Current set");
  } finally {
    await server.close();
  }
});

test("PATCH days: post-freeze, Original is left completely untouched", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome", start_date: pastStart });
    const instanceId = (created.json as any).id as number;
    const before = (await server.db.get<{ original_days_snapshot: unknown }>("SELECT original_days_snapshot FROM plan_instances WHERE id = $1", [instanceId]))!;
    assert.equal((typeof before.original_days_snapshot === "string" ? JSON.parse(before.original_days_snapshot) : before.original_days_snapshot as unknown[]).length, 7, "frozen at creation with the full 7-day set");

    const res = await server.api(`/api/v1/plan-instances/${instanceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: [{ section_name: "Base", week_number: 1, date: pastStart, dsl: "D1: 8km @ RG" }] }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const after = (await server.db.get<{ original_days_snapshot: unknown }>("SELECT original_days_snapshot FROM plan_instances WHERE id = $1", [instanceId]))!;
    assert.equal((typeof after.original_days_snapshot === "string" ? JSON.parse(after.original_days_snapshot) : after.original_days_snapshot as unknown[]).length, 7, "Original still holds its frozen 7-day snapshot, unaffected by the post-freeze Current edit");
  } finally {
    await server.close();
  }
});

test("PATCH one day: pre-freeze, Original's snapshot is refreshed to match", async () => {
  const server = await startTestServer();
  try {
    const templateId = await createTemplate(server);
    const created = await instantiate(server, templateId, { schedule_timezone: "Europe/Rome" });
    const instanceId = (created.json as any).id as number;
    const dayId = (created.json as any).days[0].id as number;

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${dayId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: "swapped shoes" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));

    const row = (await server.db.get<{ original_days_snapshot: unknown }>("SELECT original_days_snapshot FROM plan_instances WHERE id = $1", [instanceId]))!;
    const snapshot = typeof row.original_days_snapshot === "string" ? JSON.parse(row.original_days_snapshot) : row.original_days_snapshot as any[];
    assert.equal(snapshot.find((d: any) => d.id === dayId).notes, "swapped shoes");
  } finally {
    await server.close();
  }
});
