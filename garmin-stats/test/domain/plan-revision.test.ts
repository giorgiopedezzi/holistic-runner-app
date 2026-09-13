/**
 * test/domain/plan-revision.test.ts (HRA-336)
 * daySetChanged / dayPatchChanged — the no-op detection current_revision
 * bumping depends on. Pure, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayPatchChanged, daySetChanged, type RevisionComparableDay } from "../../src/domain/plan-revision.ts";

function comparableDay(overrides: Partial<RevisionComparableDay> = {}): RevisionComparableDay {
  return {
    section_name: "Base", week_number: 1, day: 1, date: "2026-09-10", suffix: null, category: null,
    workout_type: "run", segments: JSON.stringify([{ a: 1 }]), activity_target: null, activity_description: null,
    notes: null, needs_review: 0, ...overrides,
  };
}

test("daySetChanged: identical single-day sets are not a change", () => {
  const a = comparableDay();
  const b = comparableDay();
  assert.equal(daySetChanged([a], [b]), false);
});

test("daySetChanged: a re-save with a different workout_id-irrelevant field (none here) but same slot/content stays a no-op even if the JSON key order differs", () => {
  const a = comparableDay({ segments: JSON.stringify({ x: 1, y: 2 }) });
  const b = comparableDay({ segments: JSON.stringify({ y: 2, x: 1 }) });
  assert.equal(daySetChanged([a], [b]), false, "cosmetic JSON re-serialization must never register as a change");
});

test("daySetChanged: different content on the same slot is a change", () => {
  const a = comparableDay({ notes: "before" });
  const b = comparableDay({ notes: "after" });
  assert.equal(daySetChanged([a], [b]), true);
});

test("daySetChanged: a day moved to a different slot is a change", () => {
  const a = comparableDay({ week_number: 1 });
  const b = comparableDay({ week_number: 2 });
  assert.equal(daySetChanged([a], [b]), true);
});

test("daySetChanged: a different number of days is always a change", () => {
  const a = comparableDay();
  assert.equal(daySetChanged([a], [a, comparableDay({ day: 2 })]), true);
  assert.equal(daySetChanged([a, comparableDay({ day: 2 })], [a]), true);
});

test("daySetChanged: empty sets on both sides are not a change", () => {
  assert.equal(daySetChanged([], []), false);
});

const BASE_ROW = {
  day: 1, suffix: null, category: null, workout_type: "run", segments: JSON.stringify([{ a: 1 }]),
  activity_target: null, activity_description: null, notes: "hello", needs_review: 0,
  scheduled_time: null, workout_id: "w1",
};

test("dayPatchChanged: resending the exact same dsl fields + notes is a no-op", () => {
  const changed = dayPatchChanged(BASE_ROW, {
    dslFields: { day: 1, suffix: null, category: null, workout_type: "run", segments: JSON.stringify([{ a: 1 }]), activity_target: null, activity_description: null, notes: "hello", needs_review: 0 },
  });
  assert.equal(changed, false);
});

test("dayPatchChanged: a dsl field that actually differs (segments) is a change", () => {
  const changed = dayPatchChanged(BASE_ROW, {
    dslFields: { day: 1, suffix: null, category: null, workout_type: "run", segments: JSON.stringify([{ a: 2 }]), activity_target: null, activity_description: null, notes: "hello", needs_review: 0 },
  });
  assert.equal(changed, true);
});

test("dayPatchChanged: notes-only patch with the same value is a no-op", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { notes: "hello" }), false);
});

test("dayPatchChanged: notes-only patch with a different value is a change", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { notes: "goodbye" }), true);
});

test("dayPatchChanged: scheduled_time set to the same existing null value is a no-op", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { scheduledTime: null }), false);
});

test("dayPatchChanged: scheduled_time changed is a change", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { scheduledTime: "07:00" }), true);
});

test("dayPatchChanged: workoutId echoed back unchanged is a no-op", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { workoutId: "w1" }), false);
});

test("dayPatchChanged: workoutId actually reassigned is a change", () => {
  assert.equal(dayPatchChanged(BASE_ROW, { workoutId: "w2" }), true);
});

test("dayPatchChanged: no fields supplied at all is a no-op", () => {
  assert.equal(dayPatchChanged(BASE_ROW, {}), false);
});
