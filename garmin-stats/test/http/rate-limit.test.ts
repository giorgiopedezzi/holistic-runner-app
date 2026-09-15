/**
 * test/http/rate-limit.test.ts (HRA-356 AC8)
 * checkRateLimit() is a minimal in-process fixed-window limiter used for
 * import (sync) routes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../../src/http/rate-limit.ts";

test("checkRateLimit allows requests under the max within the window", () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 5; i++) assert.equal(checkRateLimit(key, { windowMs: 60_000, max: 5 }), true);
});

test("checkRateLimit rejects once the max is exceeded within the window", () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 3; i++) checkRateLimit(key, { windowMs: 60_000, max: 3 });
  assert.equal(checkRateLimit(key, { windowMs: 60_000, max: 3 }), false);
});

test("checkRateLimit tracks distinct keys independently", () => {
  const a = `test-a-${Math.random()}`;
  const b = `test-b-${Math.random()}`;
  for (let i = 0; i < 3; i++) checkRateLimit(a, { windowMs: 60_000, max: 3 });
  assert.equal(checkRateLimit(a, { windowMs: 60_000, max: 3 }), false);
  assert.equal(checkRateLimit(b, { windowMs: 60_000, max: 3 }), true);
});

test("checkRateLimit resets once the window elapses", () => {
  const key = `test-${Math.random()}`;
  assert.equal(checkRateLimit(key, { windowMs: 1, max: 1 }), true);
  assert.equal(checkRateLimit(key, { windowMs: 1, max: 1 }), false);
  return new Promise<void>(resolve => {
    setTimeout(() => {
      assert.equal(checkRateLimit(key, { windowMs: 1, max: 1 }), true);
      resolve();
    }, 15);
  });
});
