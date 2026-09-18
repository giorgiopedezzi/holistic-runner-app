// ── Statistical workout classifier ────────────────────────────────────────
// The system classifier is deterministic, has no LLM or network call, and is
// expressed as explicit logic over WorkoutSummary plus current athlete
// metrics. It is deliberately scoped to pace variance / splits / distance —
// no heart-rate thresholds — since this app has no HR-zone/max-HR setting
// to make "Zone 1/2" a well-defined statistical threshold.
//
// HRA-394: the actual-running taxonomy now reuses the planned-workout
// vocabulary (easy_recovery/long_run/intervals/progressive/threshold/tempo)
// plus one actual-only fallback, tapasciata. Tapasciata is the conservative
// "insufficient configured training context or evidence" fallback — it is
// no longer a pattern the classifier detects from pauses; pauses alone must
// never define it (see stats-classifier.test.ts).
//
// Pure function, no I/O — same "pure logic, no I/O" spirit as
// workout-metrics.ts itself.

import type { WorkoutSummary } from "./workout-metrics.ts";

export const ACTUAL_RUNNING_CLASSIFICATIONS = [
  "easy_recovery",
  "long_run",
  "intervals",
  "progressive",
  "threshold",
  "tempo",
  "tapasciata",
] as const;
export type ActualRunningClassification = typeof ACTUAL_RUNNING_CLASSIFICATIONS[number];

export interface StatsClassificationResult {
  classification: ActualRunningClassification;
  explanation: string;
}

export interface AthleteClassificationMetrics {
  currentEasyPaceSecPerKm: number | null;
  currentRacePaceSecPerKm: number | null;
  currentLongRunTargetM: number | null;
}

// These are classifier-shape fallbacks, not fabricated athlete metrics. The
// UI names missing profile values before execution; the pure classifier then
// retains its established generic behavior for only the missing influence.
const LONG_SESSION_KM = 15;
const LONG_SESSION_MIN = 90;
const HIGH_VARIANCE_STDDEV_MINKM = 0.5; // pace swings at least this big (min/km) count as "high variance"
const PROGRESSIVE_MIN_SPLITS = 3;
const PROGRESSIVE_DECREASE_RATIO = 0.7; // fraction of consecutive splits that must get faster
const INTERVAL_MIN_SPLITS = 4;
const INTERVAL_REVERSAL_RATIO = 0.5; // fraction of consecutive split-pairs whose pace direction flips

function highVarianceThreshold(metrics: AthleteClassificationMetrics): number {
  const easy = metrics.currentEasyPaceSecPerKm;
  const race = metrics.currentRacePaceSecPerKm;
  if (easy == null || race == null || easy <= race) return HIGH_VARIANCE_STDDEV_MINKM;

  // Scale the existing variance rule to the athlete's current easy-to-race
  // pace range. The floor prevents a very narrow/accidental range from making
  // ordinary GPS noise look like intensity work; the old 0.5 min/km rule is
  // the ceiling and remains the explicit fallback when either pace is absent.
  return Math.max(0.2, Math.min(HIGH_VARIANCE_STDDEV_MINKM, (easy - race) / 60 / 2));
}

// Splits the athlete's own easy-pace..race-pace range into thirds — the same
// "slowest/middle/fastest pace third" semantics categoryVisuals.tsx already
// documents for planned threshold/tempo/easy_recovery days — and places the
// run's average pace in one of them. Returns null when there isn't enough
// configured context to place the pace deterministically (never a fabricated
// guess): the caller falls back to tapasciata in that case.
function paceTier(
  avgPaceMinKm: number | null,
  easySecPerKm: number | null,
  raceSecPerKm: number | null,
): Exclude<ActualRunningClassification, "long_run" | "intervals" | "progressive"> | null {
  if (avgPaceMinKm == null) return null;
  const avgSecPerKm = avgPaceMinKm * 60;

  if (easySecPerKm != null && raceSecPerKm != null && easySecPerKm > raceSecPerKm) {
    const third = (easySecPerKm - raceSecPerKm) / 3;
    if (avgSecPerKm <= raceSecPerKm + third) return "threshold"; // fastest third
    if (avgSecPerKm >= easySecPerKm - third) return "easy_recovery"; // slowest third
    return "tempo"; // middle third
  }

  // Only one boundary configured — still deterministic when the average pace
  // clearly sits on that boundary's own side, never a fabricated midpoint.
  if (easySecPerKm != null && avgSecPerKm >= easySecPerKm) return "easy_recovery";
  if (raceSecPerKm != null && avgSecPerKm <= raceSecPerKm) return "threshold";
  return null;
}

export function classifyByStatistics(
  summary: WorkoutSummary,
  metrics: AthleteClassificationMetrics = {
    currentEasyPaceSecPerKm: null,
    currentRacePaceSecPerKm: null,
    currentLongRunTargetM: null,
  },
): StatsClassificationResult {
  // Conservative fallback (HRA-394): with no configured training context at
  // all, there is nothing to deterministically place a run against — every
  // newly imported run is immediately tapasciata, before any evidence check.
  if (
    metrics.currentEasyPaceSecPerKm == null &&
    metrics.currentRacePaceSecPerKm == null &&
    metrics.currentLongRunTargetM == null
  ) {
    return {
      classification: "tapasciata",
      explanation: "No easy pace, race pace, or long-run target configured — insufficient training context to classify.",
    };
  }

  const distanceKm = (summary.distanceM ?? 0) / 1000;
  const durationMin = (summary.durationSec ?? 0) / 60;
  const stdev = summary.paceStdDevMinKm ?? 0;
  const varianceThreshold = highVarianceThreshold(metrics);
  const longSessionKm = metrics.currentLongRunTargetM == null
    ? LONG_SESSION_KM
    : metrics.currentLongRunTargetM / 1000;
  const paced = summary.splits.filter((s): s is typeof s & { avgPaceMinKm: number } => s.avgPaceMinKm != null);

  // 1. Progressive — splits get consistently faster (a descending
  // staircase), checked before Intervals since a clean progressive trend is
  // a more specific, structured pattern than sawtooth variance alone.
  if (paced.length >= PROGRESSIVE_MIN_SPLITS) {
    let decreasing = 0;
    for (let i = 1; i < paced.length; i++) {
      if (paced[i].avgPaceMinKm < paced[i - 1].avgPaceMinKm) decreasing++;
    }
    const total = paced.length - 1;
    if (total > 0 && decreasing / total >= PROGRESSIVE_DECREASE_RATIO) {
      return {
        classification: "progressive",
        explanation: `${decreasing} of ${total} consecutive splits got faster than the one before — a clear descending pace staircase.`,
      };
    }
  }

  // 2. Intervals — a sawtooth: pace direction flips often between splits,
  // combined with high overall variance (a real interval session swings
  // between hard efforts and recovery, not just gradually drifting).
  if (paced.length >= INTERVAL_MIN_SPLITS && stdev >= varianceThreshold) {
    let reversals = 0, total = 0;
    for (let i = 2; i < paced.length; i++) {
      const prevDelta = paced[i - 1].avgPaceMinKm - paced[i - 2].avgPaceMinKm;
      const delta = paced[i].avgPaceMinKm - paced[i - 1].avgPaceMinKm;
      total++;
      if (prevDelta !== 0 && delta !== 0 && Math.sign(prevDelta) !== Math.sign(delta)) reversals++;
    }
    if (total > 0 && reversals / total >= INTERVAL_REVERSAL_RATIO) {
      return {
        classification: "intervals",
        explanation: `Pace direction flips ${reversals} of ${total} times between splits, with high overall variance (${stdev.toFixed(2)} min/km) — a rhythmic hard/easy pattern.`,
      };
    }
  }

  // 3. Long run — the week's clear distance/duration outlier, regardless of
  // its pace tier (mirrors planned "week's longest run" semantics).
  if (distanceKm >= longSessionKm || durationMin >= LONG_SESSION_MIN) {
    return {
      classification: "long_run",
      explanation: `${distanceKm.toFixed(1)}km over ${durationMin.toFixed(0)}min — the day's clear distance/duration outlier.`,
    };
  }

  // 4. Otherwise, place the run's average pace against the athlete's
  // configured easy/race pace (easy_recovery / tempo / threshold — the same
  // "slowest/middle/fastest pace third" semantics as planned workouts).
  const avgPaceMinKm = summary.distanceM && summary.durationSec
    ? (summary.durationSec / 60) / (summary.distanceM / 1000)
    : null;
  const tier = paceTier(avgPaceMinKm, metrics.currentEasyPaceSecPerKm, metrics.currentRacePaceSecPerKm);
  if (tier != null) {
    return {
      classification: tier,
      explanation: `${distanceKm.toFixed(1)}km at ${avgPaceMinKm!.toFixed(2)} min/km, placed against your configured easy/race pace.`,
    };
  }

  // 5. Insufficient evidence to place this run in a structured category —
  // the conservative fallback. Never triggered by pauses alone.
  return {
    classification: "tapasciata",
    explanation: "Not enough configured training context to place this run's pace against a structured category.",
  };
}
