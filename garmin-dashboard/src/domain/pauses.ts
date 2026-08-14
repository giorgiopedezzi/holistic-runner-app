/**
 * domain/pauses.ts  (HRA-69)
 * Pure pause detection + HR-recovery extracted from ActivityModal.tsx — no
 * React, no Recharts. Two independent detection methods, picked per-activity
 * by whether every point has a real wall-clock timestamp_unix. See
 * docs/frontend.md's "Pause detection" notes for why elapsed_sec is not a
 * trustworthy per-record clock.
 */
import type { TrackPoint } from "@/types/api";

export interface Pause { afterIndex: number; durationSec: number; }
export interface HrRecoveryFlag { afterIndex: number; delta: number; }

const PAUSE_SPEED_EPS = 0.3; // m/s
const PAUSE_RESUME_TOLERANCE_SEC = 10;

// Primary path (real Garmin data): the device stops recording entirely during
// an auto-pause, so a real pause is a plain gap >= threshold between two
// consecutive points' timestamp_unix — no speed/clock heuristics needed.
export function detectPausesFromTimestamps(points: TrackPoint[], thresholdSec: number): Pause[] {
  const pauses: Pause[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].timestamp_unix, b = points[i + 1].timestamp_unix;
    if (a == null || b == null) continue;
    const gap = b - a;
    if (gap >= thresholdSec) pauses.push({ afterIndex: i, durationSec: gap });
  }
  return pauses;
}

// Fallback path (Strava, or Garmin from before timestamp_unix existed): a
// debounced run of near-zero speed. A single non-slow blip inside an otherwise
// slow stretch does NOT end the run, so one real long stop doesn't fragment
// into several short ones.
export function detectPausesHeuristic(points: TrackPoint[], thresholdSec: number): Pause[] {
  const pauses: Pause[] = [];
  const flaggedIndices = new Set<number>();

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].elapsed_sec, b = points[i + 1].elapsed_sec;
    if (a == null || b == null) continue;
    const gap = b - a;
    if (gap >= thresholdSec) {
      pauses.push({ afterIndex: i, durationSec: gap });
      flaggedIndices.add(i);
    }
  }

  let runStart: number | null = null;
  let lastSlowIdx: number | null = null;

  const finalizeRun = () => {
    if (runStart !== null && lastSlowIdx !== null && lastSlowIdx > runStart && !flaggedIndices.has(runStart)) {
      const a = points[runStart].elapsed_sec, b = points[lastSlowIdx].elapsed_sec;
      if (a != null && b != null && b - a >= thresholdSec) {
        pauses.push({ afterIndex: runStart, durationSec: b - a });
      }
    }
    runStart = null;
    lastSlowIdx = null;
  };

  for (let i = 0; i < points.length; i++) {
    const speed = points[i].speed_ms;
    const isSlow = speed != null && speed < PAUSE_SPEED_EPS;

    if (isSlow) {
      if (runStart === null) runStart = i;
      lastSlowIdx = i;
      continue;
    }
    if (runStart !== null && lastSlowIdx !== null) {
      const elapsed = points[i].elapsed_sec;
      const lastSlowElapsed = points[lastSlowIdx].elapsed_sec;
      const sinceSlow = elapsed != null && lastSlowElapsed != null ? elapsed - lastSlowElapsed : Infinity;
      if (sinceSlow > PAUSE_RESUME_TOLERANCE_SEC) finalizeRun();
    }
  }
  finalizeRun();

  return pauses.sort((x, y) => x.afterIndex - y.afterIndex);
}

// Dispatch: timestamps when every point has one, heuristic otherwise.
export function detectPauses(points: TrackPoint[], thresholdSec: number): Pause[] {
  if (thresholdSec <= 0 || points.length < 2) return [];
  const hasRealTimestamps = points.every(p => p.timestamp_unix != null);
  return hasRealTimestamps
    ? detectPausesFromTimestamps(points, thresholdSec)
    : detectPausesHeuristic(points, thresholdSec);
}

export function fmtPauseDuration(sec: number): string {
  // Round the total first, then derive m/s from the rounded integer —
  // rounding each part separately can carry a 59.6s remainder up to "60s"
  // instead of rolling over into the next minute.
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60), s = total % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

export function nearestHr(points: TrackPoint[], startIdx: number, dir: 1 | -1): number | null {
  for (let i = startIdx; i >= 0 && i < points.length; i += dir) {
    if (points[i].heart_rate != null) return points[i].heart_rate;
  }
  return null;
}

// One flag per pause: HR just before stopping minus HR right after resuming.
export function computeHrRecovery(points: TrackPoint[], pauses: Pause[]): HrRecoveryFlag[] {
  const flags: HrRecoveryFlag[] = [];
  for (const p of pauses) {
    const before = nearestHr(points, p.afterIndex, -1);
    const after = nearestHr(points, p.afterIndex + 1, 1);
    if (before != null && after != null) flags.push({ afterIndex: p.afterIndex, delta: before - after });
  }
  return flags;
}
