// ── Workout metrics ────────────────────────────────────────────────────────
// Pure functions that reduce a run's raw track_points into a compact summary
// payload for the AI classifier's prompt (see ollama-service.ts) — never the
// raw per-second array itself. Mirrors this project's existing split between
// pure logic (fit-parser.ts) and I/O (sync-garmin.ts): no DB/network access
// here, everything operates on already-fetched rows.

// Deliberately a local, minimal shape rather than importing db.ts's full
// TrackPointRow (which also carries activity_id/lat/lon this module never
// needs) — keeps this file decoupled from the DB layer entirely, and keeps
// the type honest about exactly which fields the functions below read,
// whatever the caller's query actually selected.
export interface WorkoutTrackPoint {
  elapsed_sec: number | null;
  timestamp_unix: number | null;
  distance_m: number | null;
  heart_rate: number | null;
  speed_ms: number | null;
}

// Same threshold ActivityModal.tsx's metricValue() uses to exclude near-zero
// speed from pace calculations — pace is mathematically undefined as
// speed→0, not just "very slow," so including these would blow up variance
// meaninglessly rather than reflect real pace variability.
const NEAR_ZERO_SPEED_MS = 0.05;

function paceMinKm(speedMs: number): number {
  return 1000 / speedMs / 60;
}

// Standard deviation of per-point pace (min/km) — high values flag chaotic/
// fartlek-style pace changes, low values flag a steady recovery or long run.
export function computePaceStdDev(points: WorkoutTrackPoint[]): number | null {
  const paces = points
    .filter((p): p is WorkoutTrackPoint & { speed_ms: number } => p.speed_ms != null && p.speed_ms > NEAR_ZERO_SPEED_MS)
    .map(p => paceMinKm(p.speed_ms));
  if (paces.length < 2) return null;
  const mean = paces.reduce((s, v) => s + v, 0) / paces.length;
  const variance = paces.reduce((s, v) => s + (v - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance);
}

// ── Zero-pace ("stop") detection ──────────────────────────────────────────
// A direct server-side port of ActivityModal.tsx's detectPausesFromTimestamps
// / detectPausesHeuristic — this project already learned the hard way (see
// CLAUDE.md's FIT parser notes) that a naive "speed near zero for >Nsec" scan
// is fragile: this device stops recording entirely during a real auto-pause,
// so a plain gap between consecutive points' timestamp_unix IS the pause,
// no speed heuristics needed, whenever that field is available. The speed-
// threshold heuristic is only the fallback for data that doesn't have it
// (Strava streams, or pre-backfill Garmin rows).
interface Pause { afterIndex: number; durationSec: number; }

const PAUSE_SPEED_EPS = 0.3; // m/s — matches ActivityModal.tsx
const PAUSE_RESUME_TOLERANCE_SEC = 10;

function detectPausesFromTimestamps(points: WorkoutTrackPoint[], thresholdSec: number): Pause[] {
  const pauses: Pause[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i].timestamp_unix, b = points[i + 1].timestamp_unix;
    if (a == null || b == null) continue;
    const gap = b - a;
    if (gap >= thresholdSec) pauses.push({ afterIndex: i, durationSec: gap });
  }
  return pauses;
}

function detectPausesHeuristic(points: WorkoutTrackPoint[], thresholdSec: number): Pause[] {
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

// Counts stops lasting >= thresholdSec — social stops, water breaks, traffic
// lights. Points must be chronologically ordered (same convention as
// server.ts's q.track: "ORDER BY COALESCE(elapsed_sec,distance_m) ASC").
export function countZeroPaceEvents(points: WorkoutTrackPoint[], thresholdSec = 5): number {
  if (points.length < 2) return 0;
  const hasRealTimestamps = points.every(p => p.timestamp_unix != null);
  const pauses = hasRealTimestamps
    ? detectPausesFromTimestamps(points, thresholdSec)
    : detectPausesHeuristic(points, thresholdSec);
  return pauses.length;
}

// ── Splits ─────────────────────────────────────────────────────────────────
export interface Split {
  index: number;
  distanceM: number; // real distance covered by this split — the trailing
                      // split is usually shorter than splitMeters, kept as-is
                      // rather than dropped
  avgPaceMinKm: number | null;
  avgHr: number | null;
}

// Buckets points by cumulative distance_m into splitMeters segments. Each
// split's pace is segment-duration ÷ segment-distance (not an average of
// instantaneous per-point paces) — more accurate, and immune to a single
// noisy point skewing the split.
export function computeSplits(points: WorkoutTrackPoint[], splitMeters = 1000): Split[] {
  const withDistance = points.filter((p): p is WorkoutTrackPoint & { distance_m: number } => p.distance_m != null);
  if (withDistance.length < 2) return [];

  const splits: Split[] = [];
  let segStartIdx = 0;
  let nextBoundary = splitMeters;
  let splitIndex = 0;

  const emitSplit = (endIdx: number) => {
    const segPoints = withDistance.slice(segStartIdx, endIdx + 1);
    if (segPoints.length < 2) return;
    const first = segPoints[0], last = segPoints[segPoints.length - 1];
    const segDistanceM = last.distance_m - first.distance_m;
    if (segDistanceM <= 0) return;

    let segDurationSec: number | null = null;
    if (first.timestamp_unix != null && last.timestamp_unix != null) {
      segDurationSec = last.timestamp_unix - first.timestamp_unix;
    } else if (first.elapsed_sec != null && last.elapsed_sec != null) {
      segDurationSec = last.elapsed_sec - first.elapsed_sec;
    }
    const avgPaceMinKm = segDurationSec != null && segDurationSec > 0
      ? (segDurationSec / 60) / (segDistanceM / 1000)
      : null;

    const hrVals = segPoints.map(p => p.heart_rate).filter((v): v is number => v != null);
    const avgHr = hrVals.length ? Math.round(hrVals.reduce((s, v) => s + v, 0) / hrVals.length) : null;

    splits.push({ index: splitIndex++, distanceM: Math.round(segDistanceM), avgPaceMinKm, avgHr });
  };

  for (let i = 0; i < withDistance.length; i++) {
    if (withDistance[i].distance_m >= nextBoundary) {
      emitSplit(i);
      segStartIdx = i;
      nextBoundary += splitMeters;
    }
  }
  // Trailing partial segment — included (labeled with its real, shorter
  // distance) rather than dropped, since it can still hold real signal (e.g.
  // a fast final push in a progressive run).
  if (segStartIdx < withDistance.length - 1) emitSplit(withDistance.length - 1);

  return splits;
}

// ── Top-level summary ────────────────────────────────────────────────────
export interface WorkoutSummary {
  sport: string | null;
  distanceM: number | null;
  durationSec: number | null;
  avgHr: number | null;
  paceStdDevMinKm: number | null;
  zeroPaceEvents: number;
  splits: Split[];
}

export interface WorkoutActivityInfo {
  sport: string | null;
  distance_m: number | null;
  duration_sec: number | null;
  avg_hr: number | null;
}

export function summarizeWorkout(
  activity: WorkoutActivityInfo,
  points: WorkoutTrackPoint[],
  options: { splitMeters?: number } = {},
): WorkoutSummary {
  return {
    sport: activity.sport,
    distanceM: activity.distance_m,
    durationSec: activity.duration_sec,
    avgHr: activity.avg_hr,
    paceStdDevMinKm: computePaceStdDev(points),
    zeroPaceEvents: countZeroPaceEvents(points),
    splits: computeSplits(points, options.splitMeters ?? 1000),
  };
}
