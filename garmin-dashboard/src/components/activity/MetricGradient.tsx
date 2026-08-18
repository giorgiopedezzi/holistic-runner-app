import type { ChartRow, MetricKey } from "@/domain/activity-chart";
import { hrRunnerColor, speedRampColor, speedGradientId, hrGradientId } from "./shared";

// Value-mapped stroke gradients for the two headline series — Speed/Pace
// (yellow → green → blue, green anchored on the activity's OWN average) and
// Heart rate (pink → red, on absolute bpm: 80 / 135 / 190, the same ramp the
// runner icon is colored by, so the two always agree).
//
// The gradient runs VERTICALLY, so a segment's color is the value it plots,
// not where it falls along x. It uses the default objectBoundingBox units,
// which span the drawn path's own extent — i.e. the series' min..max, not
// the (padded) axis domain. That is what lets the ramp be anchored to real
// values at all: the stops below are computed by walking that value range
// and sampling the ramp at each step, so the color at any height is the
// color that height's value deserves, whichever end of the axis it sits at.
//
// `id` must be unique per SVG: each ResponsiveContainer renders its own
// <svg>, and a url(#…) reference resolving into a different SVG in the same
// document is exactly the kind of thing that works until it doesn't.

const STOP_COUNT = 12; // sampled points along the ramp — enough to read as continuous

interface MetricGradientDefsProps {
  /** Unique-per-chart prefix for the gradient element ids. */
  id: string;
  /** The rows actually plotted, for each series' own min/mean/max. */
  rows: ChartRow[];
  /**
   * Whether faster values sit at the TOP of this chart's speed axis. True on
   * the overlay chart (its axis is reversed in pace mode precisely so that
   * up = faster in both modes); on the standalone per-metric card the axis is
   * never reversed, so in pace mode up = a higher number = slower.
   */
  speedFastAtTop: boolean;
  /** True in speed mode, false in pace mode (where lower = faster). */
  fasterIsHigherValue: boolean;
}

interface Stats { min: number; max: number; mean: number }

function statsFor(rows: ChartRow[], key: MetricKey): Stats | null {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const row of rows) {
    const v = row[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v; n++;
  }
  return n === 0 ? null : { min, max, mean: sum / n };
}

// Value → 0-1 on the ramp, with the activity's mean pinned at 0.5. The two
// halves are scaled independently on purpose: a run whose fastest burst is
// far above its mean but whose slowest is barely below it should still spend
// the full yellow→green half on that narrow slow side, or the average would
// not read as the average.
function speedRampPosition(value: number, s: Stats, fasterIsHigherValue: boolean): number {
  // Flip the sign in pace mode so "bigger" always means "faster" below.
  const sign = fasterIsHigherValue ? 1 : -1;
  const v = sign * value, lo = sign > 0 ? s.min : -s.max, hi = sign > 0 ? s.max : -s.min, mid = sign * s.mean;
  if (v <= mid) return mid === lo ? 0.5 : 0.5 * ((v - lo) / (mid - lo));
  return hi === mid ? 0.5 : 0.5 + 0.5 * ((v - mid) / (hi - mid));
}

// Stops from the top of the path's box to its bottom, sampling `color` at the
// value each height corresponds to.
function sampleStops(topValue: number, bottomValue: number, color: (v: number) => string) {
  return Array.from({ length: STOP_COUNT + 1 }, (_unused, i) => {
    const offset = i / STOP_COUNT;
    return { offset, color: color(topValue + (bottomValue - topValue) * offset) };
  });
}

export function MetricGradientDefs({ id, rows, speedFastAtTop, fasterIsHigherValue }: MetricGradientDefsProps) {
  const speed = statsFor(rows, "speed");
  const hr = statsFor(rows, "heart_rate");

  // Which end of the value range the box's top edge is: the two flags agree
  // → the higher number is up; they disagree → the axis is reversed.
  const speedTop = speed && (speedFastAtTop === fasterIsHigherValue ? speed.max : speed.min);
  const speedBottom = speed && (speedFastAtTop === fasterIsHigherValue ? speed.min : speed.max);

  return (
    <defs>
      {speed && (
        <linearGradient id={speedGradientId(id)} x1="0" y1="0" x2="0" y2="1">
          {sampleStops(speedTop!, speedBottom!, v => speedRampColor(speedRampPosition(v, speed, fasterIsHigherValue)))
            .map(s => <stop key={s.offset} offset={`${s.offset * 100}%`} stopColor={s.color} />)}
        </linearGradient>
      )}
      {/* HR's axis is never reversed anywhere — up is always more effort —
          and its ramp is absolute, so no per-activity anchoring. */}
      {hr && (
        <linearGradient id={hrGradientId(id)} x1="0" y1="0" x2="0" y2="1">
          {sampleStops(hr.max, hr.min, hrRunnerColor)
            .map(s => <stop key={s.offset} offset={`${s.offset * 100}%`} stopColor={s.color} />)}
        </linearGradient>
      )}
    </defs>
  );
}

