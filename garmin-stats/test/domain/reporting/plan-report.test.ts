/**
 * test/domain/reporting/plan-report.test.ts (HRA-338)
 * Pure week-grouping/date-span/identity helpers that sit on top of the shared
 * buildReport engine (report.ts) — never a second calculation engine, just
 * the "group by week" + "label a workout_id" bookkeeping an entire-plan
 * report needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkoutIdentities, collectPlanWeeks, planDateSpan, weekDateSpan } from "../../../src/domain/reporting/plan-report.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";
import type { OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";
import type { ScopedWorkout } from "../../../src/domain/reporting/types.ts";

function day(overrides: Partial<PlanInstanceDayRow> & { workout_id: string; date: string; week_number: number }): PlanInstanceDayRow {
  return {
    id: 1, instance_id: 1, section_name: "Base", day: 1, suffix: null, category: null,
    workout_type: "run", segments: "[]", activity_target: null, activity_description: null,
    notes: null, needs_review: 0, scheduled_time: null, customized_at: null,
    ...overrides,
  };
}

function original(overrides: Partial<OriginalDaySnapshot> & { workout_id: string; date: string; week_number: number }): OriginalDaySnapshot {
  const { id: _id, instance_id: _instanceId, ...rest } = day(overrides as Partial<PlanInstanceDayRow> & { workout_id: string; date: string; week_number: number });
  return rest;
}

test("collectPlanWeeks: one entry per distinct (section_name, week_number), ordered by earliest known date", () => {
  const currentDays = [
    day({ workout_id: "w2", date: "2026-09-17", week_number: 2 }),
    day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }),
  ];
  const weeks = collectPlanWeeks([], currentDays);
  assert.deepEqual(weeks, [{ section_name: "Base", week_number: 1 }, { section_name: "Base", week_number: 2 }]);
});

test("collectPlanWeeks: a week present ONLY in Original (removed since freeze) still gets its own entry", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-10", week_number: 1 })];
  const weeks = collectPlanWeeks(originalDays, []);
  assert.deepEqual(weeks, [{ section_name: "Base", week_number: 1 }]);
});

test("collectPlanWeeks: the same (section_name, week_number) on both sides is never duplicated", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-10", week_number: 1 })];
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10", week_number: 1 })];
  const weeks = collectPlanWeeks(originalDays, currentDays);
  assert.equal(weeks.length, 1);
});

test("weekDateSpan: the min/max date across both sides for the requested week only", () => {
  const currentDays = [
    day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }),
    day({ workout_id: "w2", date: "2026-09-12", week_number: 1 }),
    day({ workout_id: "w3", date: "2026-09-17", week_number: 2 }),
  ];
  const span = weekDateSpan([], currentDays, { section_name: "Base", week_number: 1 });
  assert.deepEqual(span, { start: "2026-09-10", end: "2026-09-12" });
});

test("weekDateSpan: a week with no days at all on either side returns a null span", () => {
  const span = weekDateSpan([], [], { section_name: "Base", week_number: 5 });
  assert.deepEqual(span, { start: null, end: null });
});

test("planDateSpan: the min/max date across the whole plan's both sides", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }), day({ workout_id: "w2", date: "2026-09-17", week_number: 2 })];
  const span = planDateSpan([], currentDays);
  assert.deepEqual(span, { start: "2026-09-10", end: "2026-09-17" });
});

test("buildWorkoutIdentities: labels each scoped workout_id from whichever side (Current, falling back to Original) has it", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10", week_number: 1, day: 3 })];
  const originalDays = [original({ workout_id: "w2", date: "2026-09-05", week_number: 1, day: 1 })]; // removed since freeze
  const scope: ScopedWorkout[] = [
    { workout_id: "w1", lineage: "unchanged", originalInRange: true, currentInRange: true, boundaryMovement: "stable" },
    { workout_id: "w2", lineage: "removed", originalInRange: true, currentInRange: false, boundaryMovement: "not_applicable" },
  ];
  const identities = buildWorkoutIdentities(
    scope,
    new Map(originalDays.map(d => [d.workout_id, d])),
    new Map(currentDays.map(d => [d.workout_id, d])),
  );
  assert.deepEqual(identities[0], {
    workoutId: "w1", sectionName: "Base", weekNumber: 1, day: 3, workoutType: "run", originalDate: null, currentDate: "2026-09-10",
  });
  assert.deepEqual(identities[1], {
    workoutId: "w2", sectionName: "Base", weekNumber: 1, day: 1, workoutType: "run", originalDate: "2026-09-05", currentDate: null,
  });
});
