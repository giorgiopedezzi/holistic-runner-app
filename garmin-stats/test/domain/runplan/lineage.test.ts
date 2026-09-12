/**
 * test/domain/runplan/lineage.test.ts (HRA-333)
 * classifyWorkoutLineage — pure, no I/O, no server/DB involved (unlike the
 * test/http/plan-instances-workout-id.test.ts integration coverage for the
 * same feature).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkoutLineage, type OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";

function day(overrides: Partial<PlanInstanceDayRow> = {}): PlanInstanceDayRow {
  return {
    id: 1, instance_id: 1, section_name: "Base", week_number: 1, date: "2026-09-01", day: 1,
    suffix: null, category: null, workout_type: "run", segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 300, raw: "5km @ RG" }]),
    activity_target: null, activity_description: null, notes: null, needs_review: 0,
    scheduled_time: null, customized_at: null, workout_id: "w1",
    ...overrides,
  };
}

function original(overrides: Partial<OriginalDaySnapshot> = {}): OriginalDaySnapshot {
  const { id: _id, instance_id: _instanceId, ...rest } = day(overrides);
  return rest;
}

test("unchanged: identical placement and content", () => {
  const [entry] = classifyWorkoutLineage([original()], [day()]);
  assert.equal(entry.status, "unchanged");
});

test("moved: section/week/day slot changed, content identical", () => {
  const [entry] = classifyWorkoutLineage(
    [original({ section_name: "Base", week_number: 1, day: 1 })],
    [day({ section_name: "Base", week_number: 2, day: 1 })],
  );
  assert.equal(entry.status, "moved");
});

test("NOT moved: only the absolute calendar date shifted (a start_date change), slot unchanged", () => {
  const [entry] = classifyWorkoutLineage(
    [original({ date: "2026-09-01" })],
    [day({ date: "2026-09-08" })],
  );
  assert.equal(entry.status, "unchanged", "a plan-wide date shift must never read as every workout having moved");
});

test("modified: same slot, different segments", () => {
  const [entry] = classifyWorkoutLineage(
    [original({ segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 300, raw: "5km @ RG" }]) })],
    [day({ segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 8000, raw: "8km" }, resolved_pace_sec_per_km: 300, raw: "8km @ RG" }]) })],
  );
  assert.equal(entry.status, "modified");
});

test("moved_and_modified: both the slot and the content changed", () => {
  const [entry] = classifyWorkoutLineage(
    [original({ week_number: 1, notes: "easy" })],
    [day({ week_number: 2, notes: "hard" })],
  );
  assert.equal(entry.status, "moved_and_modified");
});

test("removed: present only in Original, still carries the full original record", () => {
  const [entry] = classifyWorkoutLineage([original({ workout_id: "gone" })], []);
  assert.equal(entry.status, "removed");
  assert.equal(entry.current, null);
  assert.equal(entry.original?.workout_id, "gone");
});

test("added: present only in Current, has no Original counterpart", () => {
  const [entry] = classifyWorkoutLineage([], [day({ workout_id: "new" })]);
  assert.equal(entry.status, "added");
  assert.equal(entry.original, null);
  assert.equal(entry.current?.workout_id, "new");
});

test("cosmetic serialization difference (re-stringified JSON, same structural value) is never 'modified'", () => {
  const segmentsA = JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 300, raw: "5km @ RG" }]);
  // Same object, keys re-ordered — a different string, identical meaning.
  const segmentsB = JSON.stringify([{ resolved_pace_sec_per_km: 300, type: "continuous", raw: "5km @ RG", target: { raw: "5km", kind: "distance", distance_m: 5000 } }]);
  const [entry] = classifyWorkoutLineage([original({ segments: segmentsA })], [day({ segments: segmentsB })]);
  assert.equal(entry.status, "unchanged");
});

test("multiple workouts are classified independently by their own workout_id", () => {
  const entries = classifyWorkoutLineage(
    [original({ workout_id: "a", day: 1 }), original({ workout_id: "b", day: 3, section_name: "Base", week_number: 1 })],
    [day({ workout_id: "a", day: 1 }), day({ workout_id: "b", day: 3, section_name: "Base", week_number: 2 })],
  );
  const byId = new Map(entries.map(e => [e.workout_id, e]));
  assert.equal(byId.get("a")?.status, "unchanged");
  assert.equal(byId.get("b")?.status, "moved");
});
