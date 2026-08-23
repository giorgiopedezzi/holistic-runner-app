/**
 * domain/activity-chart.ts  (HRA-69)
 * Pure chart-data logic extracted from ActivityModal.tsx — no React, no
 * Recharts. Metric value/unit resolution, percentile-based axis domains, the
 * synthetic-x chart-row builder (pauses collapse to a fixed notch; outlier
 * steps get zero width), and the time/distance tick formatter. See
 * docs/frontend.md's "Activity detail chart" section for the behaviour these
 * encode.
 */
import type { TrackPoint } from "@/types/api";
import { getUnitSystem, mToFt, kmhToMph, paceKmToMi, speedUnitLabel, paceUnitLabel, elevationUnitLabel } from "@/utils/units";
import { fmtKm } from "@/utils/fmt";
import type { Pause } from "./pauses";

export type OptionalMetricKey = "heart_rate" | "altitude_m" | "cadence" | "power";
export type MetricKey  = "speed" | OptionalMetricKey;
export type SpeedMode  = "speed" | "pace";
export type XMode      = "distance" | "time";

export function metricUnit(key: MetricKey, speedMode: SpeedMode): string {
  switch (key) {
    case "heart_rate": return "bpm";
    case "speed":       return speedMode === "speed" ? speedUnitLabel() : paceUnitLabel();
    case "altitude_m":  return elevationUnitLabel();
    case "cadence":      return "spm";
    case "power":        return "W";
  }
}

export function metricValue(p: TrackPoint, key: MetricKey, speedMode: SpeedMode): number | null {
  switch (key) {
    case "heart_rate": return p.heart_rate;
    case "altitude_m":  return p.altitude_m == null ? null : (getUnitSystem() === "imperial" ? mToFt(p.altitude_m) : p.altitude_m);
    case "cadence":      return p.cadence;
    case "power":        return p.power;
    case "speed": {
      // A real 0 (or near-0) is NOT hidden here — decelerating to a stop is
      // real, informative data. Isolated sensor glitches are handled by the
      // outlier filter (displayTrack) instead.
      if (p.speed_ms == null) return null;
      const imperial = getUnitSystem() === "imperial";
      if (speedMode === "speed") {
        const kmh = p.speed_ms * 3.6;
        return imperial ? kmhToMph(kmh) : kmh;
      }
      // Pace is undefined as speed→0 (1/x blows up) — this exclusion is
      // mathematically unavoidable, not a data-hiding choice.
      if (p.speed_ms <= 0.05) return null;
      const paceMinKm = 1000 / p.speed_ms / 60;
      return imperial ? paceKmToMi(paceMinKm) : paceMinKm;
    }
  }
}

// Pace is minutes-with-a-fraction (e.g. 5.83) — render it m:ss, never a raw
// decimal. Unlike fmt.ts's fmtPace, this does NOT convert units: metricValue()
// already returns the value in the active unit, so converting again here would
// double-convert.
export function fmtMetricValue(key: MetricKey, v: number, speedMode: SpeedMode): string {
  if (key === "speed" && speedMode === "pace") {
    const m = Math.floor(v);
    const s = Math.round((v - m) * 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return v.toFixed(1);
}

// Linear-interpolated percentile over an ascending-sorted array.
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

// Mean-centered domain (95th-percentile deviation) — for the overlay chart,
// so differently-scaled series align at their means without a dual-axis lie.
export function axisDomainCentered(points: TrackPoint[], key: MetricKey, speedMode: SpeedMode): [number, number] {
  const vals = points.map(p => metricValue(p, key, speedMode)).filter((v): v is number => v != null);
  if (vals.length === 0) return [0, 1];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const devs = vals.map(v => Math.abs(v - mean)).sort((a, b) => a - b);
  const maxDev = Math.max(percentile(devs, 0.95), 0.001);
  return [mean - maxDev, mean + maxDev];
}

// Real min/max range (2nd–98th percentile, padded) — for standalone
// single-metric cards where there's no other series to align against.
export function axisDomainMinMax(points: TrackPoint[], key: MetricKey, speedMode: SpeedMode): [number, number] {
  const vals = points.map(p => metricValue(p, key, speedMode)).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (vals.length === 0) return [0, 1];
  const min = percentile(vals, 0.02), max = percentile(vals, 0.98);
  const pad = Math.max((max - min) * 0.1, 0.001);
  return [min - pad, max + pad];
}

// Pale → deep yellow by magnitude only. Shared by pause-duration and
// HR-recovery flags (same "how much" visual language, different caps).
export function magnitudeColor(magnitude: number, cap: number): string {
  const t = Math.max(0, Math.min(1, magnitude / cap));
  const from = [254, 249, 195], to = [234, 179, 8];
  const [r, g, b] = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${r},${g},${b})`;
}

export function fmtElapsedClock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// A synthetic "x" axis where every pause collapses to the same small fixed
// notch (duration is conveyed by flag color, not width), and an outlier step
// spends ZERO width instead of its real span.
export interface ChartRow { x: number; realX: number | null; pauseDurationSec?: number; pauseAfterIndex?: number; [key: string]: number | string | null | undefined; }

export function buildChartData(
  points: TrackPoint[], pauses: Pause[], xMode: XMode, metrics: MetricKey[], speedMode: SpeedMode,
  outlierMask: boolean[] = [],
): ChartRow[] {
  // Time mode uses real wall-clock elapsed time (timestamp_unix minus the
  // activity's first timestamp) whenever available, NOT elapsed_sec.
  const firstTs = xMode === "time" ? (points.find(p => p.timestamp_unix != null)?.timestamp_unix ?? null) : null;
  const rawX = (p: TrackPoint) => {
    if (xMode === "distance") return p.distance_m ?? 0;
    if (firstTs != null && p.timestamp_unix != null) return p.timestamp_unix - firstTs;
    return p.elapsed_sec ?? 0;
  };
  const pauseAfter = new Set(pauses.map(p => p.afterIndex));
  const isOutlierStep = (i: number) => outlierMask[i] || outlierMask[i + 1];

  let activeRange = 0;
  for (let i = 0; i < points.length - 1; i++) {
    if (!pauseAfter.has(i) && !isOutlierStep(i)) activeRange += Math.max(0, rawX(points[i + 1]) - rawX(points[i]));
  }
  const notch = Math.max(activeRange * 0.015, xMode === "time" ? 5 : 15);

  const rows: ChartRow[] = [];
  let cursor = 0;
  for (let i = 0; i < points.length; i++) {
    const pause = i > 0 ? pauses.find(p => p.afterIndex === i - 1) : undefined;
    if (i > 0) cursor += pause ? notch : isOutlierStep(i - 1) ? 0 : Math.max(0, rawX(points[i]) - rawX(points[i - 1]));

    if (pause) {
      const breakRow: ChartRow = { x: cursor - notch / 2, realX: null, pauseDurationSec: pause.durationSec, pauseAfterIndex: pause.afterIndex };
      for (const key of metrics) breakRow[key] = null;
      rows.push(breakRow);
    }

    const row: ChartRow = { x: cursor, realX: rawX(points[i]) };
    for (const key of metrics) row[key] = metricValue(points[i], key, speedMode);
    rows.push(row);
  }
  return rows;
}

export function xTickFormatter(rows: ChartRow[], xMode: XMode) {
  const known = rows.filter((r): r is ChartRow & { realX: number } => r.realX != null);
  return (tick: number) => {
    if (known.length === 0) return "";
    let nearest = known[0], best = Math.abs(known[0].x - tick);
    for (const k of known) {
      const d = Math.abs(k.x - tick);
      if (d < best) { best = d; nearest = k; }
    }
    return xMode === "time" ? fmtElapsedClock(nearest.realX) : fmtKm(nearest.realX);
  };
}

// Candidate step sizes (in the current distance unit — km, or miles under
// imperial), ascending. distanceTicks picks whichever makes the tick COUNT
// land closest to the 8-10 label target.
const NICE_DISTANCE_STEPS = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 5, 10, 15, 20, 25, 50, 100];
// Time mode's own candidate set — deliberately just 5/10/15 minutes (not
// distance's broader "nice number" list): workout duration is conventionally
// read in round minutes, not an arbitrary nice number.
const TIME_STEP_MINUTES = [5, 10, 15];
// Mirrors utils/units.ts's own KM_PER_MI (not exported) — kept local since
// this is the one other place distance needs unit-aware "nice number" math.
const KM_PER_MI = 1.609344;

// Shared by distanceTicks/timeTicks below — picks whichever candidate step
// (in `unitSize`-sized real units of `known[].realX`) lands the tick COUNT
// closest to an 8-10 target, then for each round-unit target finds the row
// whose REAL value is closest to it and returns THAT row's `x` (synthetic
// cursor coordinate — buildChartData collapses pauses/outlier steps to
// fixed notches, so a tick can't just be the raw target value). The shared
// `xTickFormatter` above then formats whichever row a tick lands on by its
// real value, which is why the result reads as the round number it was
// chosen for (real samples aren't necessarily bit-exact on the target, but
// always round cleanly at display precision).
function niceTicks(known: (ChartRow & { realX: number })[], unitSize: number, steps: number[]): number[] {
  if (known.length === 0) return [];
  const maxUnits = known[known.length - 1].realX / unitSize;
  if (maxUnits <= 0) return [known[0].x];

  let bestStep = steps[steps.length - 1];
  let bestScore = Infinity;
  for (const step of steps) {
    const count = Math.floor(maxUnits / step) + 1;
    if (count < 2) continue;
    const score = count >= 8 && count <= 10 ? 0 : Math.min(Math.abs(count - 8), Math.abs(count - 10));
    if (score < bestScore) { bestScore = score; bestStep = step; }
  }

  const ticks: number[] = [];
  for (let units = 0; units <= maxUnits + 1e-9; units += bestStep) {
    const targetReal = units * unitSize;
    let nearest = known[0], best = Math.abs(known[0].realX - targetReal);
    for (const r of known) {
      const d = Math.abs(r.realX - targetReal);
      if (d < best) { best = d; nearest = r; }
    }
    ticks.push(nearest.x);
  }
  return [...new Set(ticks)].sort((a, b) => a - b);
}

// Explicit tick POSITIONS for the X-axis in distance mode, landing exactly
// on round km/mi marks — never an arbitrary evenly-spaced auto-tick like
// "3.01 km" (dashboard design-system rework: "8 to 10 labels, at a perfect
// km"). Unit-aware: km normally, mi under imperial (fmtKm's own unit switch).
export function distanceTicks(rows: ChartRow[]): number[] {
  const known = rows.filter((r): r is ChartRow & { realX: number } => r.realX != null);
  const unitMeters = getUnitSystem() === "imperial" ? KM_PER_MI * 1000 : 1000;
  return niceTicks(known, unitMeters, NICE_DISTANCE_STEPS);
}

// Same idea for time mode — round 5/10/15-minute marks instead of an
// arbitrary elapsed-seconds fraction (dashboard design-system rework:
// "applies meaningful interval to time too... every 5, 10 or 15 min
// depending on the moving time").
export function timeTicks(rows: ChartRow[]): number[] {
  const known = rows.filter((r): r is ChartRow & { realX: number } => r.realX != null);
  return niceTicks(known, 60, TIME_STEP_MINUTES);
}
