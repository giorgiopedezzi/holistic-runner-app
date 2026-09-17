/**
 * test/domain/stats-classifier.test.ts  (HRA-60)
 * Pins each rule branch of classifyByStatistics(). Rules are checked in a
 * deliberate most-specific-first order (Tapasciata → Progressive → Intervals →
 * Fartlek → Long → Recovery), so each test crafts a WorkoutSummary that
 * matches its target branch and is excluded from the earlier ones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByStatistics } from "../../src/domain/stats-classifier.ts";
import type { WorkoutSummary, Split } from "../../src/domain/workout-metrics.ts";

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

test("Tapasciata — 2+ pauses wins first, regardless of pace pattern", () => {
  const r = classifyByStatistics(summary({ zeroPaceEvents: 2, paceStdDevMinKm: 0.9, splits: splits([6, 5, 4, 3]) }));
  assert.equal(r.classification, "Tapasciata / Light Maintenance");
});

test("Progressive Run — a clean descending pace staircase", () => {
  const r = classifyByStatistics(summary({ splits: splits([6, 5.5, 5, 4.5]), paceStdDevMinKm: 0.6 }));
  assert.equal(r.classification, "Progressive Run");
});

test("Repeats/Intervals — sawtooth pace with high variance", () => {
  // paces 5,6,5,6,5 → direction flips every step; not a clean progressive trend.
  const r = classifyByStatistics(summary({ splits: splits([5, 6, 5, 6, 5]), paceStdDevMinKm: 0.6 }));
  assert.equal(r.classification, "Repeats/Intervals");
});

test("Fartlek — high variance but neither progressive nor a clean sawtooth", () => {
  // Only 3 splits (interval rule needs ≥4); decreasing ratio 0.5 (<0.7).
  const r = classifyByStatistics(summary({ splits: splits([5, 6, 5]), paceStdDevMinKm: 0.6 }));
  assert.equal(r.classification, "Fartlek");
});

test("Long Session — low variance, long distance/duration", () => {
  const r = classifyByStatistics(summary({
    distanceM: 18000,
    durationSec: 6000,
    paceStdDevMinKm: 0.2,
    splits: splits([5, 5, 5, 5]),
  }));
  assert.equal(r.classification, "Long Session");
});

test("Recovery Run — low variance, short and easy", () => {
  const r = classifyByStatistics(summary({
    distanceM: 5000,
    durationSec: 1500,
    paceStdDevMinKm: 0.2,
    splits: splits([5, 5, 5]),
  }));
  assert.equal(r.classification, "Recovery Run");
});

test("classification is always one of the six known labels", () => {
  const known = new Set([
    "Tapasciata / Light Maintenance",
    "Progressive Run",
    "Repeats/Intervals",
    "Fartlek",
    "Long Session",
    "Recovery Run",
  ]);
  const r = classifyByStatistics(summary({}));
  assert.ok(known.has(r.classification));
  assert.ok(r.explanation.length > 0);
});

test("current easy and race paces scale the existing intensity threshold", () => {
  const workout = summary({ paceStdDevMinKm: 0.3, splits: splits([5, 5.2, 5.1]) });
  assert.equal(classifyByStatistics(workout).classification, "Recovery Run");
  assert.equal(classifyByStatistics(workout, {
    currentEasyPaceSecPerKm: 360,
    currentRacePaceSecPerKm: 330,
    currentLongRunTargetM: 20000,
  }).classification, "Fartlek");
});

test("current long-run target replaces only the existing distance threshold", () => {
  const workout = summary({ distanceM: 10000, durationSec: 3600, paceStdDevMinKm: 0.1 });
  assert.equal(classifyByStatistics(workout).classification, "Recovery Run");
  assert.equal(classifyByStatistics(workout, {
    currentEasyPaceSecPerKm: 360,
    currentRacePaceSecPerKm: 300,
    currentLongRunTargetM: 8000,
  }).classification, "Long Session");
});

test("a missing pace metric uses the pre-existing variance rule without fabricating its partner", () => {
  const workout = summary({ paceStdDevMinKm: 0.3, splits: splits([5, 5.2, 5.1]) });
  for (const metrics of [
    { currentEasyPaceSecPerKm: null, currentRacePaceSecPerKm: 330, currentLongRunTargetM: 20000 },
    { currentEasyPaceSecPerKm: 360, currentRacePaceSecPerKm: null, currentLongRunTargetM: 20000 },
  ]) {
    assert.equal(classifyByStatistics(workout, metrics).classification, "Recovery Run");
  }
});

test("a missing long-run target retains the existing distance/duration fallback", () => {
  const workout = summary({ distanceM: 10000, durationSec: 3600, paceStdDevMinKm: 0.1 });
  assert.equal(classifyByStatistics(workout, {
    currentEasyPaceSecPerKm: 360,
    currentRacePaceSecPerKm: 300,
    currentLongRunTargetM: null,
  }).classification, "Recovery Run");
});
