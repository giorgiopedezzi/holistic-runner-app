import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

function json(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

test("classification uses current metrics only on explicit execution and preserves a manual override", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const id = (await server.db.get<{ id: number }>("SELECT id FROM activities WHERE sport='running'"))?.id;
    assert.ok(id);
    await server.db.run("UPDATE track_points SET timestamp_unix=1754300923+(elapsed_sec/10) WHERE activity_id=$1", [id]);

    const initialMetrics = {
      current_easy_pace_sec_per_km: 360,
      current_race_pace_sec_per_km: 300,
      current_long_run_target_m: 20000,
    };
    assert.equal((await server.api("/api/v1/settings/athlete-metrics", json(initialMetrics, "PUT"))).status, 200);

    const first = await server.api(`/api/v1/activities/${id}/classify`, json({ splitMeters: 1000 }));
    assert.equal(first.status, 200);
    assert.equal((first.json as { system_classification: string }).system_classification, "easy_recovery");

    const override = await server.api(`/api/v1/activities/${id}/classification-override`, json({ classification: "tempo" }, "PUT"));
    assert.equal(override.status, 200);
    assert.equal((override.json as { manual_classification: string }).manual_classification, "tempo");

    const changedMetrics = { ...initialMetrics, current_long_run_target_m: 5000 };
    assert.equal((await server.api("/api/v1/settings/athlete-metrics", json(changedMetrics, "PUT"))).status, 200);
    const unchanged = await server.api(`/api/v1/activities/${id}`);
    assert.equal((unchanged.json as { system_classification: string }).system_classification, "easy_recovery");
    assert.equal((unchanged.json as { manual_classification: string }).manual_classification, "tempo");

    const reclassified = await server.api(`/api/v1/activities/${id}/classify`, json({ splitMeters: 1000 }));
    assert.equal(reclassified.status, 200);
    assert.equal((reclassified.json as { system_classification: string }).system_classification, "long_run");
    assert.equal((reclassified.json as { manual_classification: string }).manual_classification, "tempo");

    const restored = await server.api(`/api/v1/activities/${id}/classification-override`, { method: "DELETE" });
    assert.equal(restored.status, 200);
    assert.equal((restored.json as { system_classification: string }).system_classification, "long_run");
    assert.equal((restored.json as { manual_classification: string | null }).manual_classification, null);
  } finally {
    await server.close();
  }
});

test("Guest cannot persist a classification override", async () => {
  const server = await startTestServer({ seed: true });
  try {
    const id = (await server.db.get<{ id: number }>("SELECT id FROM activities WHERE sport='running'"))?.id;
    assert.ok(id);
    const response = await fetch(`${server.baseUrl}/api/v1/activities/${id}/classification-override`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", origin: "http://test.invalid" },
      body: JSON.stringify({ classification: "tempo" }),
    });
    assert.ok(response.status === 401 || response.status === 403);
    const stored = await server.db.get<{ manual_classification: string | null }>("SELECT manual_classification FROM activities WHERE id=$1", [id]);
    assert.equal(stored?.manual_classification, null);
  } finally {
    await server.close();
  }
});
