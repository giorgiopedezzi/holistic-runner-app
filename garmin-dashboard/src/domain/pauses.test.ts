/**
 * domain/pauses.test.ts  (HRA-69)
 * Oracle = reference activity id 200: 50:35 (3035s) duration, 35:59 (2159s)
 * moving time, so 3035 − 2159 = 876s ≈ 14.6 min across 5 pauses. Both
 * detection paths are covered: timestamp_unix present (primary) and absent
 * (heuristic fallback).
 */
import { describe, it, expect } from "vitest";
import type { TrackPoint } from "@/types/api";
import {
  detectPauses, detectPausesFromTimestamps, detectPausesHeuristic,
  fmtPauseDuration, nearestHr, computeHrRecovery,
} from "./pauses";

function pt(o: Partial<TrackPoint>): TrackPoint {
  return {
    elapsed_sec: null, timestamp_unix: null, distance_m: null, heart_rate: null,
    speed_ms: null, cadence: null, altitude_m: null, temperature: null, power: null, ...o,
  };
}

const THRESHOLD = 30;
const T0 = 1_785_832_000;

// Builds a timestamp_unix track that walks forward 1s per normal step, but
// inserts each given gap (a real pause) between two consecutive points.
function trackWithTimestampGaps(gaps: number[]): TrackPoint[] {
  const points: TrackPoint[] = [];
  let t = T0;
  points.push(pt({ timestamp_unix: t, speed_ms: 3, heart_rate: 150 }));
  for (const gap of gaps) {
    t += 1; points.push(pt({ timestamp_unix: t, speed_ms: 3, heart_rate: 150 })); // a normal 1s step
    t += gap; points.push(pt({ timestamp_unix: t, speed_ms: 3, heart_rate: 150 })); // the pause gap
  }
  return points;
}

describe("detectPausesFromTimestamps (primary path — activity 200 oracle)", () => {
  it("finds exactly 5 pauses totalling ~14.6 min from timestamp gaps", () => {
    const gaps = [360, 200, 120, 100, 96]; // sum 876s = 14.6min
    const pauses = detectPausesFromTimestamps(trackWithTimestampGaps(gaps), THRESHOLD);
    expect(pauses).toHaveLength(5);
    const total = pauses.reduce((s, p) => s + p.durationSec, 0);
    expect(total).toBe(876);
    expect(Math.round(total / 60 * 10) / 10).toBe(14.6);
  });
  it("does not flag normal 1s steps", () => {
    const points = [0, 1, 2, 3].map(i => pt({ timestamp_unix: T0 + i, speed_ms: 3 }));
    expect(detectPausesFromTimestamps(points, THRESHOLD)).toEqual([]);
  });
});

describe("detectPausesHeuristic (fallback path — no timestamp_unix)", () => {
  it("detects one sustained near-zero-speed run as a single pause", () => {
    // 0..2 moving, 3..9 stopped (7s ≥ threshold... use small threshold), 10.. moving
    const points: TrackPoint[] = [];
    for (let i = 0; i < 3; i++) points.push(pt({ elapsed_sec: i, speed_ms: 3 }));
    for (let i = 3; i < 40; i++) points.push(pt({ elapsed_sec: i, speed_ms: 0.05 })); // slow run 3..39 (36s)
    for (let i = 40; i < 45; i++) points.push(pt({ elapsed_sec: i, speed_ms: 3 }));
    const pauses = detectPausesHeuristic(points, THRESHOLD);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].durationSec).toBeGreaterThanOrEqual(THRESHOLD);
  });
  it("does not fragment a slow run on a single non-slow blip", () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 50; i++) {
      const speed = i === 25 ? 1.5 : 0.05; // one blip mid-stop, within resume tolerance
      points.push(pt({ elapsed_sec: i, speed_ms: speed }));
    }
    // A single blip must not split the ~50s stop into two.
    expect(detectPausesHeuristic(points, THRESHOLD)).toHaveLength(1);
  });
});

describe("detectPauses (dispatch)", () => {
  it("uses the timestamp path when every point has timestamp_unix", () => {
    const pauses = detectPauses(trackWithTimestampGaps([360, 200, 120, 100, 96]), THRESHOLD);
    expect(pauses).toHaveLength(5);
    expect(pauses.reduce((s, p) => s + p.durationSec, 0)).toBe(876);
  });
  it("falls back to the heuristic when any timestamp_unix is missing", () => {
    const points: TrackPoint[] = [];
    for (let i = 0; i < 3; i++) points.push(pt({ elapsed_sec: i, speed_ms: 3 })); // no timestamp_unix
    for (let i = 3; i < 40; i++) points.push(pt({ elapsed_sec: i, speed_ms: 0.05 }));
    for (let i = 40; i < 45; i++) points.push(pt({ elapsed_sec: i, speed_ms: 3 }));
    expect(detectPauses(points, THRESHOLD)).toHaveLength(1);
  });
  it("returns [] for a non-positive threshold or <2 points", () => {
    expect(detectPauses(trackWithTimestampGaps([360]), 0)).toEqual([]);
    expect(detectPauses([pt({ timestamp_unix: T0 })], THRESHOLD)).toEqual([]);
  });
});

describe("fmtPauseDuration", () => {
  it("formats seconds / minutes, rounding the total first", () => {
    expect(fmtPauseDuration(45)).toBe("45s");
    expect(fmtPauseDuration(360)).toBe("6m");
    expect(fmtPauseDuration(125)).toBe("2m5s");
    expect(fmtPauseDuration(59.6)).toBe("1m"); // rounds to 60 → 1m, no "60s" carry bug
  });
});

describe("nearestHr / computeHrRecovery", () => {
  it("finds the nearest HR scanning in a direction", () => {
    const points = [pt({ heart_rate: 160 }), pt({}), pt({ heart_rate: 120 })];
    expect(nearestHr(points, 0, 1)).toBe(160);
    expect(nearestHr(points, 1, 1)).toBe(120); // skips the null forward
    expect(nearestHr(points, 1, -1)).toBe(160); // skips the null backward
  });
  it("computes before−after HR delta per pause", () => {
    // pause afterIndex 1: HR 160 before (idx1), 120 after (idx2) → delta 40
    const points = [pt({ heart_rate: 155 }), pt({ heart_rate: 160 }), pt({ heart_rate: 120 })];
    const flags = computeHrRecovery(points, [{ afterIndex: 1, durationSec: 300 }]);
    expect(flags).toEqual([{ afterIndex: 1, delta: 40 }]);
  });
});
