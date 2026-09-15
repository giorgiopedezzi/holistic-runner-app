/**
 * test/http/security-log.test.ts (HRA-356 AC6/AC7)
 * redact() must strip session/token/code-shaped and filesystem-path
 * substrings before a line is fit to log; logSecurityEvent() must emit one
 * redacted, greppable JSON line per event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, logSecurityEvent } from "../../src/http/security-log.ts";

test("redact() removes a JWT-shaped bearer token", () => {
  const header = "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQdQw4w9WgXcQ";
  assert.ok(!redact(header).includes("eyJhbGciOiJSUzI1NiJ9"));
  assert.match(redact(header), /\[redacted/);
});

test("redact() removes a session cookie value", () => {
  const line = "Cookie: __Host-runsfree_session=abc123def456; other=1";
  const out = redact(line);
  assert.ok(!out.includes("abc123def456"));
  assert.match(out, /__Host-runsfree_session=\[redacted\]/);
});

test("redact() removes code/state/token query params", () => {
  const url = "https://api.example.com/callback?code=SECRETCODE&state=abc123";
  const out = redact(url);
  assert.ok(!out.includes("SECRETCODE"));
  assert.ok(!out.includes("abc123"));
});

test("redact() removes a Windows filesystem path (private filename/username)", () => {
  const message = String.raw`ENOENT: C:\Users\PC\Documents\activities\2026-09-01-private-run.fit not found`;
  const out = redact(message);
  assert.ok(!out.includes("Users\\PC"));
  assert.ok(!out.includes("private-run.fit"));
});

test("redact() truncates very long input", () => {
  const out = redact("x".repeat(5000));
  assert.ok(out.length < 2100);
  assert.match(out, /truncated/);
});

test("redact() handles a plain Error", () => {
  const out = redact(new Error("boom"));
  assert.match(out, /^Error: boom$/);
});

test("logSecurityEvent() emits one redacted JSON line with the event name", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    logSecurityEvent("auth.callback.failed", { reason: "token=SECRET123 leaked" });
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.type, "security_event");
  assert.equal(parsed.event, "auth.callback.failed");
  assert.ok(typeof parsed.at === "string");
  assert.ok(!parsed.reason.includes("SECRET123"));
});
