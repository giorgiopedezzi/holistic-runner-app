/**
 * test/integrations/plan-template-ai.test.ts (HRA-325)
 * Mocks global fetch to verify the adapter's request shape and its error
 * taxonomy without ever hitting a real AI provider.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generatePlanTemplate, PlanTemplateAiError, TIMEOUT_MS } from "../../src/integrations/plan-template-ai.ts";

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

function mockFetchOnce(impl: typeof fetch) {
  let calls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls++;
    return impl(...args);
  }) as typeof fetch;
  return () => calls;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("missing config produces a controlled 'AI generation unavailable' error and issues no request", async () => {
  delete process.env.PLAN_TEMPLATE_AI_API_KEY;
  const getCalls = mockFetchOnce(async () => { throw new Error("should never be called"); });

  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "missing-config");
      assert.equal(err.message, "AI generation unavailable");
      return true;
    },
  );
  assert.equal(getCalls(), 0);
});

test("issues exactly one POST with Content-Type, Bearer auth, and the configured model", async () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  const getCalls = mockFetchOnce(async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return jsonResponse(200, { choices: [{ message: { content: "hello" } }] });
  });

  const result = await generatePlanTemplate([{ role: "user", content: "hi" }]);

  assert.equal(getCalls(), 1);
  assert.equal(result, "hello");
  assert.equal(capturedUrl, "https://ai.example.test/v1/chat/completions");
  assert.equal(capturedInit?.method, "POST");
  const headers = capturedInit?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["Authorization"], "Bearer secret-test-key");
  const body = JSON.parse(capturedInit?.body as string);
  assert.equal(body.model, "test-model");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("strips a single outer markdown code fence from the assistant content", async () => {
  mockFetchOnce(async () => jsonResponse(200, { choices: [{ message: { content: "```json\n{\"a\":1}\n```" } }] }));
  const result = await generatePlanTemplate([{ role: "user", content: "hi" }]);
  assert.equal(result, '{"a":1}');
});

test("rejects an empty assistant response distinctly from a malformed one", async () => {
  mockFetchOnce(async () => jsonResponse(200, { choices: [{ message: { content: "   " } }] }));
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "empty-response");
      return true;
    },
  );
});

test("rejects a malformed (missing content) response distinctly from empty", async () => {
  mockFetchOnce(async () => jsonResponse(200, { choices: [{}] }));
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "malformed-response");
      return true;
    },
  );
});

test("rejects non-JSON bodies as malformed-response", async () => {
  mockFetchOnce(async () => new Response("not json", { status: 200 }));
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "malformed-response");
      return true;
    },
  );
});

for (const status of [401, 403]) {
  test(`HTTP ${status} surfaces as an "auth" error`, async () => {
    mockFetchOnce(async () => jsonResponse(status, { error: "nope" }));
    await assert.rejects(
      () => generatePlanTemplate([{ role: "user", content: "hi" }]),
      (err: unknown) => {
        assert.ok(err instanceof PlanTemplateAiError);
        assert.equal(err.code, "auth");
        return true;
      },
    );
  });
}

test("HTTP 429 surfaces as a distinct 'rate-limit' error", async () => {
  mockFetchOnce(async () => jsonResponse(429, { error: "slow down" }));
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "rate-limit");
      return true;
    },
  );
});

test("other non-2xx statuses surface as 'http-error', not collapsed into auth/rate-limit", async () => {
  mockFetchOnce(async () => jsonResponse(500, { error: "boom" }));
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "http-error");
      return true;
    },
  );
});

test("a network failure surfaces as a distinct 'network' error", async () => {
  mockFetchOnce(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "network");
      return true;
    },
  );
});

test("an aborted (timed-out) request surfaces as a distinct 'timeout' error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockFetchOnce((_url, init) => {
    const signal = (init as RequestInit).signal!;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });

  const pending = assert.rejects(
    () => generatePlanTemplate([{ role: "user", content: "hi" }]),
    (err: unknown) => {
      assert.ok(err instanceof PlanTemplateAiError);
      assert.equal(err.code, "timeout");
      return true;
    },
  );
  t.mock.timers.tick(TIMEOUT_MS);
  await pending;
});

test("the API key never appears in a thrown error's message", async () => {
  mockFetchOnce(async () => jsonResponse(401, { error: "nope" }));
  try {
    await generatePlanTemplate([{ role: "user", content: "hi" }]);
    assert.fail("expected rejection");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes("secret-test-key"));
  }
});
