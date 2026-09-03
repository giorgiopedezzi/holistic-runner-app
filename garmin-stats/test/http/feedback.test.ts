/**
 * test/http/feedback.test.ts (HRA-226)
 * POST /api/v1/feedback — anonymous visitor feedback. Every field is
 * independently optional, but at least one must be present; pricing_choice
 * and feature_interest entries are validated against fixed sets; the route
 * must stay reachable under DEMO_MODE (the one write route exempt from the
 * guard — see http/router.ts's HRA-226 comment).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("POST /api/v1/feedback rejects an entirely empty body with 422", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({}));
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback accepts free_text alone and returns 201 with one persisted row", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({ free_text: "Would love a coach mode." }));
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const row = res.json as { id: number; free_text: string };
    assert.equal(row.free_text, "Would love a coach mode.");

    const count = server.db.prepare("SELECT COUNT(*) AS count FROM feedback").get() as { count: number };
    assert.equal(count.count, 1);
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback rejects an unrecognized pricing_choice with 422", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({ pricing_choice: "unlimited" }));
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback accepts each of the four defined pricing tiers", async () => {
  const server = await startTestServer({ seed: false });
  try {
    for (const tier of ["free_only", "3_5", "8_12", "15_plus"]) {
      const res = await server.api("/api/v1/feedback", json({ pricing_choice: tier }));
      assert.equal(res.status, 201, `${tier}: ${JSON.stringify(res.json)}`);
    }
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback rejects an unrecognized feature_interest entry with 422", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({ feature_interest: ["multi_user_coach", "time_travel"] }));
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback rejects an unrecognized app_type_choice with 422", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({ app_type_choice: "mobile" }));
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback accepts each of the two defined app types", async () => {
  const server = await startTestServer({ seed: false });
  try {
    for (const appType of ["cloud", "desktop"]) {
      const res = await server.api("/api/v1/feedback", json({ app_type_choice: appType }));
      assert.equal(res.status, 201, `${appType}: ${JSON.stringify(res.json)}`);
    }
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback accepts a full submission across all sections and persists it", async () => {
  const server = await startTestServer({ seed: false });
  try {
    const res = await server.api("/api/v1/feedback", json({
      free_text: "Great app.",
      pricing_choice: "free_only",
      pricing_why_not_free_text: "Student budget.",
      app_type_choice: "cloud",
      feature_interest: ["multi_user_coach", "shared_groups"],
      feature_interest_other_free_text: "Team leaderboards",
    }));
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const row = res.json as { feature_interest: string };
    assert.deepEqual(JSON.parse(row.feature_interest), ["multi_user_coach", "shared_groups"]);
  } finally {
    await server.close();
  }
});

test("POST /api/v1/feedback returns 201 with DEMO_MODE enabled (the one write route exempt from the guard)", async () => {
  const server = await startTestServer({ seed: false, demoMode: true });
  try {
    const res = await server.api("/api/v1/feedback", json({ free_text: "Demo visitor feedback." }));
    assert.equal(res.status, 201, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});
