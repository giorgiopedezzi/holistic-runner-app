/**
 * domain/runner-dynamics.ts
 * Pure per-chart-row motion parameters for the chart's little runner — no
 * React, no Recharts. Three channels, all absolute readings of the activity
 * rather than derived "how fast is this changing" signals:
 *
 *   - stride rate      ← the speed itself, as a ratio against this
 *                        activity's median moving speed. Cadence genuinely
 *                        rises with pace, so the legs turn over faster when
 *                        the runner is actually running faster — and unlike
 *                        horizontal travel this reads identically in both
 *                        distance and time x-modes.
 *
 *   - vertical offset  ← the altitude itself, measured against the
 *                        activity's own mean so the runner sits mid-row on
 *                        flat ground and rides up and down the profile from
 *                        there. 1 metre = 1 pixel wherever that fits the
 *                        reserved band, compressed to fit when it doesn't —
 *                        see ELEVATION_PX_PER_M.
 *   - moving seconds   ← cumulative moving time at that row. This is what
 *                        makes the runner travel CONSISTENTLY WITH PACE:
 *                        autoplay advances this clock at a constant rate, so
 *                        the runner's horizontal progress across the chart is
 *                        whatever the runner's own speed made it. Sweeping
 *                        the x-domain uniformly instead (the earlier
 *                        behaviour) covered ground at a constant rate in
 *                        distance mode, which is exactly the thing that has
 *                        no relation to how fast the run actually was.
 *
 * Pause gaps are excluded from the clock: it is MOVING time, so a ten-minute
 * coffee stop doesn't eat a third of the playback. Autoplay's own fixed dwell
 * (ActivityChartSection) is what represents a pause instead.
 *
 * Rows, not track points: chartData carries an inserted break row per pause,
 * so the row↔point mapping lives here (advance the point cursor only on
 * non-pause rows) rather than being re-derived by every caller.
 */
import type { TrackPoint } from "@/types/api";
import type { ChartRow } from "./activity-chart";

export interface RunnerDynamics {
  /** Multiplier on the base stride alternation rate (1 = this run's median). */
  strideScale: number;
  /** Pixels above the row's vertical center; negative = below it. */
  elevationPx: number;
  /** Cumulative moving seconds at this row — monotonically non-decreasing. */
  movingSec: number;
}

export const NEUTRAL_DYNAMICS: RunnerDynamics = { strideScale: 1, elevationPx: 0, movingSec: 0 };

// Half the vertical travel, in pixels. The runner's row must reserve this
// much space above AND below its center or the glyph clips at the extremes —
// ActivityChartSection sizes that row off this constant, so the reservation
// can never silently drift out of step with the clamp.
export const RUNNER_ELEVATION_MAX_PX = 40;

// Preferred scale: 1 metre of altitude = 1 pixel of vertical travel. It is a
// CEILING, not a fixed rate — an activity whose profile doesn't fit the band
// at 1:1 is compressed to fit rather than clipped against it. A clamp alone
// looked fine on gentle runs and lied badly on the ones where altitude is the
// story: a marathon rising 140m from a 51m mean pinned the runner to the top
// of the band for its entire opening descent, showing a flat start to the
// steepest part of the route. Flat and rolling runs are unaffected — they
// keep the literal 1m = 1px — so the scale only ever moves where 1:1 was not
// representable in the first place.
const ELEVATION_PX_PER_M = 1;

// Stride rate is the speed ratio against this run's median, bounded: an
// easy-jog kilometre in a session full of intervals still has to look like
// running, and a 400m rep still has to look like legs rather than a blur.
const STRIDE_MIN = 0.55;
const STRIDE_MAX = 1.8;
// Below this a "speed" is a GPS twitch at a standstill, not a pace — its
// ratio would swing the stride wildly for no real movement.
const MIN_SPEED_MS = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Median, not mean: a single GPS spike (or a long standstill the pause
// detector didn't catch) drags a mean far enough to mis-scale every stride
// in the activity.
function median(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(vals: (number | null)[]): number | null {
  let sum = 0, n = 0;
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) { sum += v; n++; }
  }
  return n === 0 ? null : sum / n;
}

// Real wall-clock seconds for a point. timestamp_unix is the only trustworthy
// per-record clock on Garmin files (elapsed_sec drifts against wall time — see
// CLAUDE.md's FIT parser notes); elapsed_sec is the fallback for sources where
// it genuinely is elapsed time, e.g. Strava's `time` stream.
function pointSeconds(p: TrackPoint): number | null {
  return p.timestamp_unix ?? p.elapsed_sec ?? null;
}

/** One entry per CHART ROW, in the same order as `rows`. */
export function computeRunnerDynamics(points: TrackPoint[], rows: ChartRow[]): RunnerDynamics[] {
  // Mean, not min: an out-and-back that starts and ends low would otherwise
  // spend the whole activity pinned to the top of the band. Centering on the
  // mean spends the reserved space on both sides of the profile.
  const meanAltitude = mean(points.map(p => p.altitude_m ?? null));
  const anyClock = points.some(p => pointSeconds(p) != null);
  // Scaled against this run's OWN median rather than an absolute m/s: the
  // stride has to read as "faster than usual for this run" on an easy jog
  // and on a tempo alike, and an absolute scale would peg one of the two.
  const medianSpeed = median(
    points.map(p => p.speed_ms).filter((v): v is number => v != null && Number.isFinite(v) && v >= MIN_SPEED_MS),
  );
  // Fit the profile's furthest excursion from the mean into the band — 1:1
  // whenever it already fits, compressed when it doesn't. Symmetric (driven
  // by the larger of the two sides) rather than stretching min..max across
  // the full band: a route that climbs 90m and drops 47m should LOOK
  // lopsided, because it is.
  const maxDeviation = points.reduce((worst, p) => {
    if (p.altitude_m == null || meanAltitude == null) return worst;
    return Math.max(worst, Math.abs(p.altitude_m - meanAltitude));
  }, 0);
  const pxPerM = maxDeviation * ELEVATION_PX_PER_M > RUNNER_ELEVATION_MAX_PX
    ? RUNNER_ELEVATION_MAX_PX / maxDeviation
    : ELEVATION_PX_PER_M;

  let pointIdx = -1;
  let movingSec = 0;
  let prevSec: number | null = null;
  let lastElevationPx = 0;

  return rows.map(row => {
    // A pause row keeps whatever altitude the runner stopped at — it is
    // standing still on the hill, not teleporting back to mid-row — and
    // freezes the clock so the pause's own gap never enters moving time.
    if (row.pauseDurationSec != null) {
      prevSec = null;
      return { strideScale: 1, elevationPx: lastElevationPx, movingSec };
    }

    pointIdx += 1;
    const p = points[pointIdx];
    if (!p) return { strideScale: 1, elevationPx: lastElevationPx, movingSec };

    if (anyClock) {
      const sec = pointSeconds(p);
      if (sec != null) {
        if (prevSec != null) movingSec += Math.max(0, sec - prevSec);
        prevSec = sec;
      }
    } else {
      // No usable clock anywhere in the track (some imported sources): fall
      // back to one "second" per row, i.e. the uniform sweep. Honest default
      // — with no timing data there is no pace to be consistent with.
      movingSec += 1;
    }

    const alt = p.altitude_m;
    lastElevationPx = alt == null || meanAltitude == null
      ? 0
      : clamp((alt - meanAltitude) * pxPerM, -RUNNER_ELEVATION_MAX_PX, RUNNER_ELEVATION_MAX_PX);

    const speed = p.speed_ms;
    const strideScale = speed == null || speed < MIN_SPEED_MS || medianSpeed == null || medianSpeed <= 0
      ? 1
      : clamp(speed / medianSpeed, STRIDE_MIN, STRIDE_MAX);

    return { strideScale, elevationPx: lastElevationPx, movingSec };
  });
}
