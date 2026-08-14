/**
 * domain/outliers.ts  (HRA-69)
 * Pure track-outlier detection extracted from ActivityModal.tsx — no React,
 * no Recharts. Two independent rules, both scoped to Speed and Cadence:
 * an isolated-spike delta filter and an absolute min-speed floor. See
 * docs/frontend.md's "Outlier removal" notes for the behaviour these encode.
 */
import type { TrackPoint } from "@/types/api";

// Real elapsed seconds between two samples — timestamp_unix when present
// (falling back to elapsed_sec), so the delta rate below stays meaningful
// across sampling gaps rather than assuming a fixed 1s cadence.
export function sampleGapSec(a: TrackPoint, b: TrackPoint): number {
  if (a.timestamp_unix != null && b.timestamp_unix != null) {
    const d = Math.abs(b.timestamp_unix - a.timestamp_unix);
    return d > 0 ? d : 1;
  }
  if (a.elapsed_sec != null && b.elapsed_sec != null) {
    const d = Math.abs(b.elapsed_sec - a.elapsed_sec);
    return d > 0 ? d : 1;
  }
  return 1;
}

// Isolated-spike rule: a point is flagged only when it differs from BOTH its
// previous and next valid neighbor faster than a per-second rate. A genuine
// sustained change (a real sprint) only produces one big delta at the
// transition and then stays elevated, so it's never flagged; only a value
// that jumps away and immediately back is.
export function computeOutlierMask(points: TrackPoint[], valueOf: (p: TrackPoint) => number | null, deltaPerSecThreshold: number): boolean[] {
  const mask = points.map(() => false);
  if (!(deltaPerSecThreshold > 0)) return mask;

  for (let i = 0; i < points.length; i++) {
    const v = valueOf(points[i]);
    if (v == null) continue;

    let prevRate: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const pv = valueOf(points[j]);
      if (pv != null) { prevRate = Math.abs(v - pv) / sampleGapSec(points[j], points[i]); break; }
    }
    let nextRate: number | null = null;
    for (let j = i + 1; j < points.length; j++) {
      const nv = valueOf(points[j]);
      if (nv != null) { nextRate = Math.abs(v - nv) / sampleGapSec(points[i], points[j]); break; }
    }

    if (prevRate != null && nextRate != null && prevRate > deltaPerSecThreshold && nextRate > deltaPerSecThreshold) {
      mask[i] = true;
    }
  }
  return mask;
}

// Absolute floor for Speed/Pace only: any sample slower than minSpeedKmh is
// dropped outright ("not really running"), regardless of whether it looks
// like an isolated spike.
export function computeMinSpeedMask(points: TrackPoint[], minSpeedKmh: number): boolean[] {
  if (!(minSpeedKmh > 0)) return points.map(() => false);
  const minSpeedMs = minSpeedKmh / 3.6;
  return points.map(p => p.speed_ms != null && p.speed_ms < minSpeedMs);
}
