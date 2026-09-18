/**
 * test/domain/stats-classifier.test.ts  (HRA-60, retaxonomized HRA-394)
 * Pins each rule branch of classifyByStatistics() against the actual-running
 * taxonomy (easy_recovery/long_run/intervals/progressive/threshold/tempo/
 * tapasciata). Rules are checked in a deliberate most-specific-first order
 * (no-context → Progressive → Intervals → Long run → pace tier → fallback),
 * so each test crafts a WorkoutSummary that matches its target branch and is
 * excluded from the earlier ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTUAL_RUNNING_CLASSIFICATIONS, classifyByStatistics } from "../../src/domain/stats-classifier.ts";
import type { WorkoutSummary, Split } from "../../src/domain/workout-metrics.ts";

const FULL_METRICS = { currentEasyPaceSecPerKm: 360, currentRacePaceSecPerKm: 300, currentLongRunTargetM: 20000 };

function splits(paces: number[]): Split[] {
  return paces.map((avgPaceMinKm, index) => ({
    index,
    distanceM: 1000,
    avgPaceMinKm,
    avgHr: 150,
  }));
}

function summary(over: Partial<WorkoutSummary>): WorkoutSummary {
  return {
    sport: "running",
    distanceM: 5000,
    durationSec: 1500,
    avgHr: 150,
    paceStdDevMinKm: 0.1,
    zeroPaceEvents: 0,
    splits: [],
    ...over,
  };
}

test("no configured training context — tapasciata immediately, before any evidence check", () => {
  // Splits/variance here would otherwise read as a clean interval session —
  // proves the no-context fallback wins regardless of pattern evidence.
  const r = classifyByStatistics(summary({ splits: splits([5, 6, 5, 6, 5]), paceStdDevMinKm: 0.9 }));
  assert.equal(r.classification, "tapasciata");
});

test("Progressive — a clean descending pace staircase", () => {
  const r = classifyByStatistics(summary({ splits: splits([6, 5.5, 5, 4.5]), paceStdDevMinKm: 0.6 }), FULL_METRICS);
  assert.equal(r.classification, "progressive");
});

test("Intervals — sawtooth pace with high variance", () => {
  // paces 5,6,5,6,5 → direction flips every step; not a clean progressive trend.
  const r = classifyByStatistics(summary({ splits: splits([5, 6, 5, 6, 5]), paceStdDevMinKm: 0.6 }), FULL_METRICS);
  assert.equal(r.classification, "intervals");
});

test("Long run — the day's clear distance/duration outlier, regardless of pace tier", () => {
  const r = classifyByStatistics(summary({
    distanceM: 18000,
    durationSec: 18000 * 5 * 60 / 1000, // fast pace (5 min/km) — still long_run on distance alone
    paceStdDevMinKm: 0.2,
    splits: splits([5, 5, 5, 5]),
  }), FULL_METRICS);
  assert.equal(r.classification, "long_run");
});

test("Easy/Recovery — average pace in the slowest third of the athlete's easy..race range", () => {
  const r = classifyByStatistics(summary({
    distanceM: 5000,
    durationSec: 5000 * 6 / 1000 * 60, // 6:00/km == configured easy pace
    paceStdDevMinKm: 0.1,
    splits: splits([6, 6, 6]),
  }), FULL_METRICS);
  assert.equal(r.classification, "easy_recovery");
});

test("Tempo — average pace in the middle third of the athlete's easy..race range", () => {
  const r = classifyByStatistics(summary({
    distanceM: 5000,
    durationSec: 5000 * 5.5 / 1000 * 60, // 5:30/km — midway between 6:00 easy and 5:00 race
    paceStdDevMinKm: 0.1,
    splits: splits([5.5, 5.5, 5.5]),
  }), FULL_METRICS);
  assert.equal(r.classification, "tempo");
});

test("Threshold — average pace in the fastest third of the athlete's easy..race range", () => {
  const r = classifyByStatistics(summary({
    distanceM: 5000,
    durationSec: 5000 * 5 / 1000 * 60, // 5:00/km == configured race pace
    paceStdDevMinKm: 0.1,
    splits: splits([5, 5, 5]),
  }), FULL_METRICS);
  assert.equal(r.classification, "threshold");
});

test("multiple pauses alone never define tapasciata — a run otherwise classifiable stays classified", () => {
  const r = classifyByStatistics(summary({
    distanceM: 5000,
    durationSec: 5000 * 6 / 1000 * 60,
    paceStdDevMinKm: 0.1,
    zeroPaceEvents: 5,
    splits: splits([6, 6, 6]),
  }), FULL_METRICS);
  assert.equal(r.classification, "easy_recovery");
});

test("classification is always one of the seven known actual-running labels", () => {
  const known = new Set<string>(ACTUAL_RUNNING_CLASSIFICATIONS);
  const r = classifyByStatistics(summary({}), FULL_METRICS);
  assert.ok(known.has(r.classification));
  assert.ok(r.explanation.length > 0);
});

test("current long-run target replaces only the existing distance threshold", () => {
  const workout = summary({ distanceM: 10000, durationSec: 10000 * 6 / 1000 * 60, paceStdDevMinKm: 0.1 });
  assert.equal(classifyByStatistics(workout, FULL_METRICS).classification, "easy_recovery");
  assert.equal(classifyByStatistics(workout, { ...FULL_METRICS, currentLongRunTargetM: 8000 }).classification, "long_run");
});

test("a missing race pace with only easy pace configured still deterministically resolves an easy-paced run", () => {
  const workout = summary({ distanceM: 5000, durationSec: 5000 * 6.5 / 1000 * 60, paceStdDevMinKm: 0.1 });
  const r = classifyByStatistics(workout, { currentEasyPaceSecPerKm: 360, currentRacePaceSecPerKm: null, currentLongRunTargetM: null });
  assert.equal(r.classification, "easy_recovery");
});

test("partial settings that cannot deterministically place the pace fall back to tapasciata, never fabricating the missing setting", () => {
  // 5:20/km is faster than the configured easy pace but there's no race pace
  // to bound the tempo/threshold split — insufficient evidence, not a guess.
  const workout = summary({ distanceM: 5000, durationSec: 5000 * 5.3333 / 1000 * 60, paceStdDevMinKm: 0.1 });
  const r = classifyByStatistics(workout, { currentEasyPaceSecPerKm: 360, currentRacePaceSecPerKm: null, currentLongRunTargetM: null });
  assert.equal(r.classification, "tapasciata");
});

test("current easy and race paces scale the existing intensity threshold used by Intervals", () => {
  const workout = summary({ paceStdDevMinKm: 0.3, splits: splits([5, 6, 5, 6, 5]) });
  // Wide default threshold (0.5) — 0.3 stdev isn't "high variance" without scaling.
  assert.notEqual(classifyByStatistics(workout, FULL_METRICS).classification, "intervals");
  // Narrow athlete-scaled threshold makes the same stdev read as high variance.
  assert.equal(classifyByStatistics(workout, {
    currentEasyPaceSecPerKm: 360,
    currentRacePaceSecPerKm: 330,
    currentLongRunTargetM: 20000,
  }).classification, "intervals");
});
