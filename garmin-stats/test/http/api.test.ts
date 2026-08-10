/**
 * test/http/api.test.ts  (HRA-61)
 * Integration tests through the whole request pipeline (router → controllers →
 * services → repositories) against a real http server on an ephemeral port,
 * driven with fetch() like the dashboard.
 *
 * Written at BEHAVIOR altitude: assertions target semantics that survive the
 * HRA-36 contract epic. The few that pin the current wire contract (status
 * codes / body shape HRA-36 will change) are grouped and clearly marked so V1
 * (HRA-37) is a small, obvious diff — see "contract seams" below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, type TestServer } from "../helpers/server.ts";

async function withServer(fn: (s: TestServer) => Promise<void>, opts: { seed?: boolean } = { seed: true }) {
  const s = await startTestServer(opts);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ── Reads ────────────────────────────────────────────────────────────────────

test("GET /api/activities returns seeded rows, newest first, both sources", async () => {
  await withServer(async (s) => {
    const { status, json: rows } = await s.api("/api/activities?from=2026-01-01&to=2027-01-01");
    assert.equal(status, 200);
    assert.ok(Array.isArray(rows));
    const list = rows as { source: string; date_only: string }[];
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((r) => r.source), ["garmin", "strava"]); // ORDER BY activity_date DESC
  });
});

test("GET /api/activities respects the from/to range filter", async () => {
  await withServer(async (s) => {
    const { json: rows } = await s.api("/api/activities?from=2026-08-01&to=2026-08-31");
    const list = rows as { source: string }[];
    assert.equal(list.length, 1);
    assert.equal(list[0].source, "garmin");
  });
});

test("GET /api/range and /api/activities/count reflect the seed", async () => {
  await withServer(async (s) => {
    const range = (await s.api("/api/range")).json as { min_date: string; max_date: string };
    assert.equal(range.min_date, "2026-07-20");
    assert.equal(range.max_date, "2026-08-04");

    const count = (await s.api("/api/activities/count?from=2026-01-01&to=2027-01-01")).json as { count: number };
    assert.equal(count.count, 2);
  });
});

test("GET /api/summary groups by sport", async () => {
  await withServer(async (s) => {
    const rows = (await s.api("/api/summary?from=2026-01-01&to=2027-01-01")).json as { sport: string }[];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.sport).sort(), ["cycling", "running"]);
  });
});

test("GET /api/activities/:id and /:id/track return the item and its points", async () => {
  await withServer(async (s) => {
    const id = s.db.prepare("SELECT id FROM activities WHERE source='garmin'").get() as { id: number };
    const item = (await s.api(`/api/activities/${id.id}`)).json as { id: number; source: string };
    assert.equal(item.id, id.id);
    assert.equal(item.source, "garmin");

    const track = (await s.api(`/api/activities/${id.id}/track`)).json as unknown[];
    assert.equal(track.length, 3);
  });
});

// ── Soft-delete → trash → restore → purge lifecycle (semantic, HRA-36-proof) ──

test("full soft-delete lifecycle: hide → trash → restore → purge keeps dedup key", async () => {
  await withServer(async (s) => {
    const id = (s.db.prepare("SELECT id FROM activities WHERE source='garmin'").get() as { id: number }).id;
    const filename = (s.db.prepare("SELECT filename FROM activities WHERE id=?").get(id) as { filename: string }).filename;

    // 1. Soft delete → gone from reads, present in trash.
    const del = await s.api(`/api/activities/${id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    let list = (await s.api("/api/activities?from=2026-01-01&to=2027-01-01")).json as unknown[];
    assert.equal(list.length, 1, "soft-deleted activity should not appear in reads");
    let trash = (await s.api("/api/activities/trash")).json as { id: number }[];
    assert.deepEqual(trash.map((t) => t.id), [id]);

    // 2. Restore → back in reads, gone from trash.
    const restored = await s.api("/api/activities/restore", json({ ids: [id] }));
    assert.equal(restored.status, 200);
    list = (await s.api("/api/activities?from=2026-01-01&to=2027-01-01")).json as unknown[];
    assert.equal(list.length, 2);
    trash = (await s.api("/api/activities/trash")).json as { id: number }[];
    assert.equal(trash.length, 0);

    // 3. Delete again, then purge → gone from trash; filename survives; track_points wiped.
    await s.api(`/api/activities/${id}`, { method: "DELETE" });
    const purged = await s.api("/api/activities/purge", json({ ids: [id] }));
    assert.equal(purged.status, 200);
    trash = (await s.api("/api/activities/trash")).json as { id: number }[];
    assert.equal(trash.length, 0, "purged rows are not listed in trash");

    const row = s.db.prepare("SELECT filename, purged, distance_m FROM activities WHERE id=?").get(id) as
      { filename: string; purged: number; distance_m: number | null };
    assert.equal(row.purged, 1);
    assert.equal(row.filename, filename, "filename MUST survive purge — it's the resync dedup key");
    assert.equal(row.distance_m, null, "heavy columns are wiped on purge");
    const tp = (s.db.prepare("SELECT COUNT(*) AS c FROM track_points WHERE activity_id=?").get(id) as { c: number }).c;
    assert.equal(tp, 0, "track points are deleted on purge");
  });
});

test("DELETE /api/activities?from&to soft-deletes a whole range", async () => {
  await withServer(async (s) => {
    const del = await s.api("/api/activities?from=2026-01-01&to=2027-01-01", { method: "DELETE" });
    assert.equal(del.status, 200);
    const list = (await s.api("/api/activities?from=2026-01-01&to=2027-01-01")).json as unknown[];
    assert.equal(list.length, 0);
    const trash = (await s.api("/api/activities/trash")).json as unknown[];
    assert.equal(trash.length, 2);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

test("GET /api/settings returns the seeded singleton with defaults", async () => {
  await withServer(async (s) => {
    const row = (await s.api("/api/settings")).json as {
      theme: string; unit_system: string; outlier_speed_delta_per_sec: number; min_trend_group_size: number;
    };
    assert.equal(row.theme, "auto");
    assert.equal(row.unit_system, "auto");
    assert.equal(row.outlier_speed_delta_per_sec, 2.0);
    assert.equal(row.min_trend_group_size, 5);
  });
});

test("PUT /api/settings/theme persists a valid theme and rejects an invalid one", async () => {
  await withServer(async (s) => {
    const ok = await s.api("/api/settings/theme", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "dark" }) });
    assert.equal(ok.status, 200);
    assert.equal((ok.json as { theme: string }).theme, "dark");

    const bad = await s.api("/api/settings/theme", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "neon" }) });
    assert.equal(bad.status, 422); // validation failure (parsed OK, breaks the rule) — HRA-37
  });
});

test("PUT /api/settings persists valid outlier thresholds and rejects bad ones", async () => {
  await withServer(async (s) => {
    const body = { outlier_speed_delta_per_sec: 3, outlier_cadence_delta_per_sec: 70, outlier_min_speed_kmh: 5, min_trend_group_size: 4 };
    const ok = await s.api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(ok.status, 200);
    assert.equal((ok.json as { min_trend_group_size: number }).min_trend_group_size, 4);

    const bad = await s.api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, outlier_speed_delta_per_sec: -1 }) });
    assert.equal(bad.status, 422); // validation failure — HRA-37
  });
});

// ── Validation / stable error behavior ───────────────────────────────────────

test("validation failures return 422 (parsed OK, breaks a rule) — HRA-37", async () => {
  await withServer(async (s) => {
    const emptyIds = await s.api("/api/activities/restore", json({ ids: [] }));
    assert.equal(emptyIds.status, 422);

    const badFeedback = await s.api("/api/activities/1/feedback", json({ feedback: "maybe", source: "ai" }));
    assert.equal(badFeedback.status, 422);
  });
});

test("malformed JSON body returns 400, not 500 — HRA-33/HRA-37", async () => {
  await withServer(async (s) => {
    const res = await s.api("/api/activities/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{ not json" });
    assert.equal(res.status, 400);
    assert.equal((res.json as { title: string }).title, "Bad Request");
  });
});

test("feedback on a missing activity returns 404 problem+json with a clear detail", async () => {
  await withServer(async (s) => {
    const res = await s.api("/api/activities/999999/feedback", json({ feedback: "approved", source: "ai" }));
    assert.equal(res.status, 404);
    assert.match((res.json as { detail: string }).detail, /not found/i);
  });
});

test("GET /api/body/correlation returns 200 with [] when empty, not 204 — HRA-32", async () => {
  await withServer(async (s) => {
    const res = await s.api("/api/body/correlation?from=1999-01-01&to=1999-12-31");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
  });
});

test("OPTIONS preflight advertises the mutating methods", async () => {
  await withServer(async (s) => {
    const res = await fetch(`${s.baseUrl}/api/activities`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    const allow = res.headers.get("access-control-allow-methods") ?? "";
    for (const m of ["GET", "POST", "PUT", "DELETE"]) assert.ok(allow.includes(m), `Allow-Methods should include ${m}`);
  });
});

// ── Error contract (RFC 7807 problem+json — HRA-37) ──────────────────────────

test("unknown route returns 404 problem+json", async () => {
  await withServer(async (s) => {
    const res = await s.api("/api/does-not-exist");
    assert.equal(res.status, 404);
    const p = res.json as { type: string; title: string; status: number; detail: string };
    assert.equal(p.type, "about:blank");
    assert.equal(p.title, "Not Found");
    assert.equal(p.status, 404);
    assert.match(p.detail, /no route matches/i);
  });
});

test("GET a missing activity returns 404 problem+json (was 200-empty) — HRA-34/HRA-37", async () => {
  await withServer(async (s) => {
    const res = await s.api("/api/activities/999999");
    assert.equal(res.status, 404);
    assert.equal((res.json as { title: string }).title, "Not Found");
  });
});

test("error responses carry the application/problem+json content type", async () => {
  await withServer(async (s) => {
    const res = await fetch(`${s.baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") ?? "", /application\/problem\+json/);
  });
});
