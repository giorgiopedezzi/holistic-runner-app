/**
 * test/domain/reporting/scope.test.ts (HRA-335, AC6/AC7/AC10/AC11)
 * classifyScopeBoundary / classifyActualPopulation — pure, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyActualPopulation, classifyScopeBoundary, type AssociationLookup } from "../../../src/domain/reporting/scope.ts";
import type { OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";

function day(overrides: Partial<PlanInstanceDayRow> & { workout_id: string; date: string }): PlanInstanceDayRow {
  return {
    id: 1, instance_id: 1, section_name: "Base", week_number: 1, day: 1, suffix: null, category: null,
    workout_type: "run", segments: "[]", activity_target: null, activity_description: null, notes: null,
    needs_review: 0, scheduled_time: null, customized_at: null,
    ...overrides,
  };
}

function original(overrides: Partial<OriginalDaySnapshot> & { workout_id: string; date: string }): OriginalDaySnapshot {
  const { id: _id, instance_id: _instanceId, ...rest } = day(overrides as Partial<PlanInstanceDayRow> & { workout_id: string; date: string });
  return rest;
}

const ROME = "Europe/Rome";
const insideWeek1 = (date: string) => date <= "2026-09-07"; // week 1 boundary in these fixtures

test("stable: unchanged workout inside range on both sides", () => {
  const [entry] = classifyScopeBoundary(
    [original({ workout_id: "w1", date: "2026-09-01" })],
    [day({ workout_id: "w1", date: "2026-09-01" })],
    insideWeek1,
  );
  assert.equal(entry.lineage, "unchanged");
  assert.deepEqual([entry.originalInRange, entry.currentInRange, entry.boundaryMovement], [true, true, "stable"]);
});

test("moved_out: Original placement was inside the range, Current moved it outside", () => {
  const [entry] = classifyScopeBoundary(
    [original({ workout_id: "w1", date: "2026-09-01", week_number: 1 })],
    [day({ workout_id: "w1", date: "2026-09-10", week_number: 2 })],
    insideWeek1,
  );
  assert.equal(entry.lineage, "moved");
  assert.equal(entry.boundaryMovement, "moved_out");
});

test("moved_in: Original placement was outside the range, Current moved it inside", () => {
  const [entry] = classifyScopeBoundary(
    [original({ workout_id: "w1", date: "2026-09-10", week_number: 2 })],
    [day({ workout_id: "w1", date: "2026-09-01", week_number: 1 })],
    insideWeek1,
  );
  assert.equal(entry.lineage, "moved");
  assert.equal(entry.boundaryMovement, "moved_in");
});

test("not_applicable: workout stays outside the range on both sides", () => {
  const [entry] = classifyScopeBoundary(
    [original({ workout_id: "w1", date: "2026-09-10" })],
    [day({ workout_id: "w1", date: "2026-09-12" })],
    insideWeek1,
  );
  assert.equal(entry.boundaryMovement, "not_applicable");
});

test("removed: present only in Original — no Current counterpart, boundary reflects Original's own placement only", () => {
  const [entry] = classifyScopeBoundary([original({ workout_id: "w1", date: "2026-09-01" })], [], insideWeek1);
  assert.equal(entry.lineage, "removed");
  assert.deepEqual([entry.originalInRange, entry.currentInRange], [true, false]);
  assert.equal(entry.boundaryMovement, "moved_out"); // was in scope, now has nothing there
});

test("added: present only in Current — no Original counterpart", () => {
  const [entry] = classifyScopeBoundary([], [day({ workout_id: "w1", date: "2026-09-01" })], insideWeek1);
  assert.equal(entry.lineage, "added");
  assert.deepEqual([entry.originalInRange, entry.currentInRange], [false, true]);
  assert.equal(entry.boundaryMovement, "moved_in");
});

test("empty plan (no Original, no Current) produces an empty scope list, not a fabricated entry", () => {
  assert.deepEqual(classifyScopeBoundary([], [], insideWeek1), []);
});

// ── classifyActualPopulation ─────────────────────────────────────────────

function lookup(activityId: number, workoutId: string | null, status: AssociationLookup["status"]): [number, AssociationLookup] {
  return [activityId, { activity_id: activityId, workout_id: workoutId, status }];
}

test("an accepted association (automatic/manual_confirmed/manual_changed with a workout_id) is trusted evidence", () => {
  const result = classifyActualPopulation(
    [{ activity_id: 1, activity_date: "2026-09-01T07:00:00Z" }],
    new Map([lookup(1, "w1", "automatic")]),
    ROME,
  );
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].workout_id, "w1");
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.extra, []);
});

test("an 'unresolved' association is ambiguous — visible in coverage, excluded from trusted totals (AC11)", () => {
  const result = classifyActualPopulation(
    [{ activity_id: 1, activity_date: "2026-09-01T07:00:00Z" }],
    new Map([lookup(1, "w1", "unresolved")]),
    ROME,
  );
  assert.deepEqual(result.accepted, []);
  assert.equal(result.ambiguous.length, 1);
});

test("an activity with no association row at all is extra/unplanned (AC7), same as an explicit workout_id=null row", () => {
  const noRow = classifyActualPopulation([{ activity_id: 1, activity_date: "2026-09-01T07:00:00Z" }], new Map(), ROME);
  assert.equal(noRow.extra.length, 1);

  const explicitlyCleared = classifyActualPopulation(
    [{ activity_id: 2, activity_date: "2026-09-01T07:00:00Z" }],
    new Map([lookup(2, null, "manual_changed")]),
    ROME,
  );
  assert.equal(explicitlyCleared.extra.length, 1);
});

test("actual-only case: activities exist with zero accepted evidence — the population is all extra, not a fabricated zero-workout result", () => {
  const result = classifyActualPopulation(
    [{ activity_id: 1, activity_date: "2026-09-01T07:00:00Z" }, { activity_id: 2, activity_date: "2026-09-02T07:00:00Z" }],
    new Map(),
    ROME,
  );
  assert.equal(result.extra.length, 2);
  assert.equal(result.accepted.length, 0);
});

test("empty activities list produces an entirely empty population (planned-only case)", () => {
  assert.deepEqual(classifyActualPopulation([], new Map(), ROME), { accepted: [], ambiguous: [], extra: [] });
});
