/**
 * test/http/plan-templates-ai-generate.test.ts (HRA-329)
 * POST /api/v1/plan-templates/ai-generate — the real, billable "Genera DSL
 * con AI" call. Mocks global fetch (same technique as
 * test/integrations/plan-template-ai.test.ts) so the AI provider adapter's
 * own request/response handling is exercised end-to-end through the real
 * HTTP pipeline, without ever hitting a real provider.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const ENV_KEYS = ["PLAN_TEMPLATE_AI_ENDPOINT", "PLAN_TEMPLATE_AI_API_KEY", "PLAN_TEMPLATE_AI_MODEL"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.PLAN_TEMPLATE_AI_ENDPOINT = "https://ai.example.test/v1/chat/completions";
  process.env.PLAN_TEMPLATE_AI_API_KEY = "secret-test-key";
  process.env.PLAN_TEMPLATE_AI_MODEL = "test-model";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});

// Only intercepts calls to the (fake) AI provider endpoint — everything else
// (notably server.api()'s own outbound request to the real local test
// server, on the same process-global fetch) passes through to the real
// fetch, so mocking the provider never breaks the test's own HTTP client.
function mockFetch(impl: typeof fetch) {
  globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(url) !== process.env.PLAN_TEMPLATE_AI_ENDPOINT) return originalFetch(url, init);
    return impl(url, init);
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("text is required", async () => {
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 422, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("rejects an invalid event/unit/distance_m the same way prompt-preview does", async () => {
  const server = await startTestServer();
  try {
    const badEvent = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Riposo", event: "ultra" }),
    });
    assert.equal(badEvent.status, 422, JSON.stringify(badEvent.json));

    const badUnit = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Riposo", unit: "furlongs" }),
    });
    assert.equal(badUnit.status, 422, JSON.stringify(badUnit.json));

    const badDistance = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Riposo", distance_m: -5 }),
    });
    assert.equal(badDistance.status, 422, JSON.stringify(badDistance.json));
  } finally {
    await server.close();
  }
});

test("rejected (403) when DEMO_MODE is on, without issuing any provider request", async () => {
  mockFetch(async () => { throw new Error("should never be called in demo mode"); });
  const server = await startTestServer({ demoMode: true });
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
    });
    assert.equal(res.status, 403, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("success: returns {dsl, model, generated_at}, sending the composed prompt to the provider", async () => {
  let capturedBody: { model?: string; messages?: { role: string; content: string }[] } | undefined;
  mockFetch(async (_url, init) => {
    capturedBody = JSON.parse((init as RequestInit).body as string);
    return jsonResponse(200, { choices: [{ message: { content: "D1: REST # Riposo" } }] });
  });
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Riposo", event: "marathon" }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const json = res.json as { dsl: string; model: string; generated_at: string };
    assert.equal(json.dsl, "D1: REST # Riposo");
    assert.equal(json.model, "test-model");
    assert.ok(!Number.isNaN(Date.parse(json.generated_at)));
    // Composed prompt must actually carry the pasted plan text through the
    // same <training_plan> envelope prompt-preview uses (HRA-326).
    assert.ok(capturedBody?.messages?.[0]?.content.includes("<training_plan>\nRiposo\n</training_plan>"));
  } finally {
    await server.close();
  }
});

const ERROR_CASES: { status: number; providerStatus: number; name: string }[] = [
  { status: 502, providerStatus: 401, name: "auth" },
  { status: 429, providerStatus: 429, name: "rate-limit" },
  { status: 502, providerStatus: 500, name: "http-error" },
];

for (const { status, providerStatus, name } of ERROR_CASES) {
  test(`a provider ${name} failure (HTTP ${providerStatus}) surfaces as ${status}, not a generic 500`, async () => {
    mockFetch(async () => jsonResponse(providerStatus, { error: "boom" }));
    const server = await startTestServer();
    try {
      const res = await server.api("/api/v1/plan-templates/ai-generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
      });
      assert.equal(res.status, status, JSON.stringify(res.json));
    } finally {
      await server.close();
    }
  });
}

test("an empty AI response surfaces as 502", async () => {
  mockFetch(async () => jsonResponse(200, { choices: [{ message: { content: "   " } }] }));
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
    });
    assert.equal(res.status, 502, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("a malformed (non-JSON) AI response surfaces as 502", async () => {
  mockFetch(async () => new Response("not json", { status: 200 }));
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
    });
    assert.equal(res.status, 502, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

test("missing provider config surfaces as 503, not a generic 500", async () => {
  delete process.env.PLAN_TEMPLATE_AI_API_KEY;
  mockFetch(async () => { throw new Error("should never be called"); });
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
    });
    assert.equal(res.status, 503, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});

// A real HTTP-level timeout test would need to fake global timers, which
// also breaks the real local http test server's own timer-dependent
// internals (observed hang). The "timeout" -> 504 mapping is a trivial,
// visually-verifiable one-line switch case in mapPlanTemplateAiError, and
// PlanTemplateAiError's own "timeout" code generation is already unit-tested
// in test/integrations/plan-template-ai.test.ts — covered there instead.

test("a network failure surfaces as 502", async () => {
  mockFetch(async () => { throw new TypeError("fetch failed"); });
  const server = await startTestServer();
  try {
    const res = await server.api("/api/v1/plan-templates/ai-generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Riposo" }),
    });
    assert.equal(res.status, 502, JSON.stringify(res.json));
  } finally {
    await server.close();
  }
});
