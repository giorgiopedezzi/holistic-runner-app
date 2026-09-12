/**
 * test/domain/plan-timezone.test.ts (HRA-332)
 * isValidIanaTimeZone / localDateInTimeZone / isOriginalFrozen — pure
 * functions, no I/O. Covers invalid zones, DST transitions, and the
 * freeze-boundary predicate per the Story's AC10.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOriginalFrozen, isValidIanaTimeZone, localDateInTimeZone } from "../../src/domain/plan-timezone.ts";

test("isValidIanaTimeZone accepts real IANA identifiers", () => {
  assert.equal(isValidIanaTimeZone("Europe/Rome"), true);
  assert.equal(isValidIanaTimeZone("America/New_York"), true);
  assert.equal(isValidIanaTimeZone("UTC"), true);
  assert.equal(isValidIanaTimeZone("Pacific/Auckland"), true);
});

test("isValidIanaTimeZone rejects unsupported/invalid identifiers", () => {
  assert.equal(isValidIanaTimeZone("Not/AZone"), false);
  assert.equal(isValidIanaTimeZone("GMT+2"), false);
  assert.equal(isValidIanaTimeZone(""), false);
  // @ts-expect-error deliberately wrong type at the boundary
  assert.equal(isValidIanaTimeZone(undefined), false);
});

test("localDateInTimeZone returns the local calendar date, not the UTC one", () => {
  // 2026-03-01T23:30:00Z is already 2026-03-02 in Europe/Rome (UTC+1 in March,
  // before DST) but still 2026-03-01 in America/New_York (UTC-5).
  const instant = new Date("2026-03-01T23:30:00Z");
  assert.equal(localDateInTimeZone(instant, "Europe/Rome"), "2026-03-02");
  assert.equal(localDateInTimeZone(instant, "America/New_York"), "2026-03-01");
});

test("localDateInTimeZone is correct across a DST transition", () => {
  // Europe/Rome springs forward on 2026-03-29 (02:00 -> 03:00 CEST). An
  // instant just before and just after the transition must still resolve to
  // the correct calendar day, not drift because of the offset change.
  assert.equal(localDateInTimeZone(new Date("2026-03-29T00:30:00Z"), "Europe/Rome"), "2026-03-29");
  assert.equal(localDateInTimeZone(new Date("2026-03-29T23:30:00Z"), "Europe/Rome"), "2026-03-30");
});

test("isOriginalFrozen is false while today is strictly before the first local plan day", () => {
  // Europe/Rome is CEST (UTC+2) in September — 20:00Z is still 22:00 local
  // on the 19th.
  assert.equal(isOriginalFrozen("2026-09-20", "Europe/Rome", new Date("2026-09-19T20:00:00Z")), false);
});

test("isOriginalFrozen is true once today reaches the first local plan day", () => {
  assert.equal(isOriginalFrozen("2026-09-20", "Europe/Rome", new Date("2026-09-19T23:30:00Z")), true);
});

test("isOriginalFrozen stays true for any later date (moving start_date later never unfreezes)", () => {
  assert.equal(isOriginalFrozen("2026-09-01", "Europe/Rome", new Date("2026-09-20T12:00:00Z")), true);
});

test("isOriginalFrozen: a travel/browser timezone change never applies automatically — only the instance's own stored schedule_timezone matters", () => {
  // Same instant, evaluated against two different stored timezones — the
  // caller's own "current" timezone (e.g. a traveling browser) is never
  // consulted, only whatever schedule_timezone is actually persisted.
  const instant = new Date("2026-09-19T23:30:00Z");
  assert.equal(isOriginalFrozen("2026-09-20", "Europe/Rome", instant), true, "already 2026-09-20 in Rome");
  assert.equal(isOriginalFrozen("2026-09-20", "America/Los_Angeles", instant), false, "still 2026-09-19 in LA");
});
