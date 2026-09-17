// ── Statistical workout classifier ────────────────────────────────────────
// The system classifier is deterministic, has no LLM or network call, and is
// expressed as explicit logic over WorkoutSummary plus current athlete
// metrics. It is deliberately scoped to pace variance / splits / zero-pace
// events —
// no heart-rate thresholds — since this app has no HR-zone/max-HR setting
// to make "Zone 1/2" a well-defined statistical threshold; distance,
// duration, pace-variance and pause count are enough to distinguish all six
// categories on their own.
//
// Pure function, no I/O — same "pure logic, no I/O" spirit as
// workout-metrics.ts itself.

import type { WorkoutSummary } from "./workout-metrics.ts";
import type { WorkoutClassification } from "../integrations/ollama.ts";

export interface StatsClassificationResult {
  classification: WorkoutClassification;
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
const TAPASCIATA_MIN_PAUSES = 2;
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

export function classifyByStatistics(
  summary: WorkoutSummary,
  metrics: AthleteClassificationMetrics = {
    currentEasyPaceSecPerKm: null,
    currentRacePaceSecPerKm: null,
    currentLongRunTargetM: null,
  },
): StatsClassificationResult {
  const distanceKm = (summary.distanceM ?? 0) / 1000;
  const durationMin = (summary.durationSec ?? 0) / 60;
  const stdev = summary.paceStdDevMinKm ?? 0;
  const varianceThreshold = highVarianceThreshold(metrics);
  const longSessionKm = metrics.currentLongRunTargetM == null
    ? LONG_SESSION_KM
    : metrics.currentLongRunTargetM / 1000;
  const pauses = summary.zeroPaceEvents;
  const paced = summary.splits.filter((s): s is typeof s & { avgPaceMinKm: number } => s.avgPaceMinKm != null);

  // 1. Tapasciata / Light Maintenance — multiple real stops is the clearest,
  // least ambiguous signal, so it's checked first regardless of pace variance.
  if (pauses >= TAPASCIATA_MIN_PAUSES) {
    return {
      classification: "Tapasciata / Light Maintenance",
      explanation: `${pauses} pauses over 5s detected — a casual session with multiple stops, not continuous running.`,
    };
  }

  // 2. Progressive Run — splits get consistently faster (a descending
  // staircase), checked before Fartlek/Intervals since a clean progressive
  // trend is a more specific, structured pattern than "high variance" alone.
  if (paced.length >= PROGRESSIVE_MIN_SPLITS) {
    let decreasing = 0;
    for (let i = 1; i < paced.length; i++) {
      if (paced[i].avgPaceMinKm < paced[i - 1].avgPaceMinKm) decreasing++;
    }
    const total = paced.length - 1;
    if (total > 0 && decreasing / total >= PROGRESSIVE_DECREASE_RATIO) {
      return {
        classification: "Progressive Run",
        explanation: `${decreasing} of ${total} consecutive splits got faster than the one before — a clear descending pace staircase.`,
      };
    }
  }

  // 3. Repeats/Intervals — a sawtooth: pace direction flips often between
  // splits, combined with high overall variance (a real interval session
  // swings between hard efforts and recovery, not just gradually drifting).
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
        classification: "Repeats/Intervals",
        explanation: `Pace direction flips ${reversals} of ${total} times between splits, with high overall variance (${stdev.toFixed(2)} min/km) — a rhythmic hard/easy pattern.`,
      };
    }
  }

  // 4. Fartlek — high variance, but didn't match the structured patterns
  // above (not a clean progressive trend, not a clean sawtooth): irregular,
  // unstructured speed changes.
  if (stdev >= varianceThreshold) {
    return {
      classification: "Fartlek",
      explanation: `Pace variance is high (${stdev.toFixed(2)} min/km) but doesn't follow a clean progressive or interval pattern — irregular, unstructured speed changes.`,
    };
  }

  // 5. Long Session vs Recovery Run — both are low-variance/stable-pace;
  // distinguished purely by distance/duration.
  if (distanceKm >= longSessionKm || durationMin >= LONG_SESSION_MIN) {
    return {
      classification: "Long Session",
      explanation: `${distanceKm.toFixed(1)}km over ${durationMin.toFixed(0)}min with low pace variance (${stdev.toFixed(2)} min/km) — a steady endurance effort.`,
    };
  }

  return {
    classification: "Recovery Run",
    explanation: `${distanceKm.toFixed(1)}km at a stable, low-variance pace (${stdev.toFixed(2)} min/km) — a short, easy effort.`,
  };
}
