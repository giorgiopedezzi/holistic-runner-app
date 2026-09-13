/**
 * test/domain/reporting/range-report.test.ts (HRA-341)
 * Pure cross-instance aggregation/grouping helpers that sit on top of the
 * shared buildReport engine (report.ts) — never a second calculation engine,
 * just the "combine several instances' own already-computed ReportResults"
 * and "roll up several workouts' own already-computed structured-quality
 * comparisons" bookkeeping a date-range report needs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actualDatasetFromAccepted, aggregateDatasetMetrics, aggregateDenominator, buildRangeQualityEvidence,
  mergeDrillDown, resolveRangeGrouping, type RangeQualityWorkoutEntry,
} from "../../../src/domain/reporting/range-report.ts";
import type { StructuredQualityComparison } from "../../../src/domain/reporting/quality-evidence.ts";

test("resolveRangeGrouping: a short span (<=31 days) groups by workout", () => {
  assert.equal(resolveRangeGrouping("2026-09-01", "2026-09-07"), "workout");
  assert.equal(resolveRangeGrouping("2026-09-01", "2026-10-01"), "workout"); // exactly 31 days inclusive
});

test("resolveRangeGrouping: a medium span groups by week", () => {
  assert.equal(resolveRangeGrouping("2026-01-01", "2026-04-01"), "week");
});

test("resolveRangeGrouping: a long span (>1 year) groups by month", () => {
  assert.equal(resolveRangeGrouping("2025-01-01", "2026-06-01"), "month");
});

test("aggregateDatasetMetrics: sums distance/duration across instances and recomputes pace from the SUMMED totals, never an average of per-instance paces", () => {
  const result = aggregateDatasetMetrics([
    { distanceM: 10000, durationSec: 3000, paceSecPerKm: 300, approximate: false }, // 5:00/km
    { distanceM: 5000, durationSec: 1000, paceSecPerKm: 200, approximate: false },  // 3:20/km
  ]);
  // Naive average of 300/200 would be 250; the correct distance-weighted
  // total is (3000+1000)/(15) = 266.67 sec/km.
  assert.equal(result.distanceM, 15000);
  assert.equal(result.durationSec, 4000);
  assert.ok(result.paceSecPerKm != null && Math.abs(result.paceSecPerKm - 4000 / 15) < 0.001);
});

test("aggregateDatasetMetrics: an omitted field on every input stays omitted in the result, never present-as-zero", () => {
  const result = aggregateDatasetMetrics([{}, {}]);
  assert.equal(result.distanceM, undefined);
  assert.equal(result.durationSec, undefined);
  assert.equal("paceSecPerKm" in result, false);
});

test("aggregateDenominator: sums each field across instances", () => {
  const result = aggregateDenominator([
    { total: 5, completed: 3, missed: 2, upcoming: 0 },
    { total: 2, completed: 1, missed: 0, upcoming: 1 },
  ]);
  assert.deepEqual(result, { total: 7, completed: 4, missed: 2, upcoming: 1 });
});

test("aggregateDenominator: an empty list returns undefined (no denominator was ever computed), never a fabricated zero total", () => {
  assert.equal(aggregateDenominator([]), undefined);
});

test("mergeDrillDown: unions workout/activity ids across instances and folds in range-wide extra activity ids without duplicating", () => {
  const result = mergeDrillDown(
    [
      { workoutIds: ["w1"], activityIds: [1, 2] },
      { workoutIds: ["w1", "w2"], activityIds: [2, 3] },
    ],
    [3, 4],
  );
  assert.deepEqual(result.workoutIds.sort(), ["w1", "w2"]);
  assert.deepEqual(result.activityIds.sort((a, b) => a - b), [1, 2, 3, 4]);
});

test("actualDatasetFromAccepted: sums only activities present in rowsById, distance-weighted pace over the total", () => {
  const rowsById = new Map([
    [1, { distance_m: 10000, duration_sec: 3000 }],
    [2, { distance_m: 5000, duration_sec: 1500 }],
  ]);
  const result = actualDatasetFromAccepted([{ activity_id: 1 }, { activity_id: 2 }, { activity_id: 999 }], rowsById);
  assert.equal(result.distanceM, 15000);
  assert.equal(result.durationSec, 4500);
  assert.equal(result.paceSecPerKm, 4500 / 15);
});

function comparison(overrides: Partial<StructuredQualityComparison> & { kind: StructuredQualityComparison["kind"] }): StructuredQualityComparison {
  return {
    available: false, segments: [],
    totals: {
      plannedWorkDistanceM: 0, plannedWorkDurationSec: 0, actualWorkDistanceM: 0, actualWorkDurationSec: 0,
      weightedActualPaceSecPerKm: null, paceSpreadSecPerKm: null, progressivelyFaster: null,
      coverage: { totalWorkSegments: 4, alignedWorkSegments: 0 },
    },
    wholeSessionPaceSecPerKm: null,
    ...overrides,
  };
}

function qualityEntry(overrides: Partial<RangeQualityWorkoutEntry> & { comparison: StructuredQualityComparison }): RangeQualityWorkoutEntry {
  return {
    instanceId: 1, workoutId: "w1", planInstanceName: "Marathon block", sectionName: "Base", weekNumber: 1, day: 3, currentDate: "2026-09-10",
    ...overrides,
  };
}

test("buildRangeQualityEvidence: a session without reliable structure stays visible but contributes 0 aligned segments and never counts toward workoutsWithEvidence", () => {
  const evidence = buildRangeQualityEvidence([
    qualityEntry({ workoutId: "w1", comparison: comparison({ kind: "repetition", available: false }) }),
  ]);
  assert.equal(evidence.totalWorkouts, 1);
  assert.equal(evidence.workoutsWithEvidence, 0);
  assert.equal(evidence.segments.totalWorkSegments, 4);
  assert.equal(evidence.segments.alignedWorkSegments, 0);
  assert.equal(evidence.workouts.length, 1, "still visible for drill-down, never dropped");
});

test("buildRangeQualityEvidence: retains workout kind and rolls up included-session + segment coverage across workouts", () => {
  const evidence = buildRangeQualityEvidence([
    qualityEntry({
      workoutId: "w1",
      comparison: comparison({ kind: "repetition", available: true, totals: { ...comparison({ kind: "repetition" }).totals, coverage: { totalWorkSegments: 4, alignedWorkSegments: 4 } } }),
    }),
    qualityEntry({
      workoutId: "w2",
      comparison: comparison({ kind: "tempo", available: false, totals: { ...comparison({ kind: "tempo" }).totals, coverage: { totalWorkSegments: 1, alignedWorkSegments: 0 } } }),
    }),
  ]);
  assert.equal(evidence.totalWorkouts, 2);
  assert.equal(evidence.workoutsWithEvidence, 1);
  assert.equal(evidence.segments.totalWorkSegments, 5);
  assert.equal(evidence.segments.alignedWorkSegments, 4);
  assert.deepEqual(evidence.byKind.repetition, { total: 1, withEvidence: 1 });
  assert.deepEqual(evidence.byKind.tempo, { total: 1, withEvidence: 0 });
});
