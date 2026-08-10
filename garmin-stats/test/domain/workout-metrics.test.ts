/**
 * test/domain/workout-metrics.test.ts  (HRA-60)
 * Unit-tests the pure track-point reducers. Uses small, hand-crafted point
 * arrays with known-by-construction answers rather than a real FIT file, so
 * each function's contract is pinned exactly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePaceStdDev,
  computeSplits,
  countZeroPaceEvents,
  type WorkoutTrackPoint,
} from "../../src/domain/workout-metrics.ts";

// Build a steady point every `stepM` metres, `stepSec` seconds apart, giving a
// constant, known pace. timestamp_unix present unless withTs=false.
function steadyTrack(
  n: number,
  stepM: number,
  stepSec: number,
  opts: { withTs?: boolean; hr?: number } = {},
): WorkoutTrackPoint[] {
  const withTs = opts.withTs ?? true;
  const T0 = 1_785_832_123;
  const speed = stepM / stepSec;
  return Array.from({ length: n }, (_, i) => ({
    elapsed_sec: i * stepSec,
    timestamp_unix: withTs ? T0 + i * stepSec : null,
    distance_m: i * stepM,
    heart_rate: opts.hr ?? 150,
    speed_ms: speed,
  }));
}

test("computePaceStdDev: constant speed → 0, varied → >0, <2 valid → null", () => {
  const steady = steadyTrack(10, 100, 30); // constant 3.33 m/s
  assert.equal(computePaceStdDev(steady), 0);

  const varied: WorkoutTrackPoint[] = steady.map((p, i) => ({
    ...p,
    speed_ms: i % 2 === 0 ? 2.5 : 4.0,
  }));
  assert.ok((computePaceStdDev(varied) ?? 0) > 0);

  assert.equal(computePaceStdDev([]), null);
  assert.equal(computePaceStdDev([steady[0]]), null);
});

test("computePaceStdDev ignores near-zero-speed samples (pace undefined near 0)", () => {
  const pts = steadyTrack(6, 100, 30);
  // Inject two stopped samples — they must not count toward variance.
  pts[2].speed_ms = 0;
  pts[3].speed_ms = 0.01;
  assert.equal(computePaceStdDev(pts), 0, "remaining samples are all equal → 0, not skewed");
});

test("computeSplits: splitMeters controls granularity (2×1km vs 4×0.5km)", () => {
  // 0..2000m in 100m steps, 30s apart → constant 5:00 min/km.
  const pts = steadyTrack(21, 100, 30);

  const km = computeSplits(pts, 1000);
  assert.equal(km.length, 2);
  for (const s of km) {
    assert.equal(s.distanceM, 1000);
    assert.ok(Math.abs((s.avgPaceMinKm ?? 0) - 5) < 0.01, `pace=${s.avgPaceMinKm}`);
  }

  const half = computeSplits(pts, 500);
  assert.equal(half.length, 4);
  for (const s of half) assert.equal(s.distanceM, 500);

  assert.deepEqual(computeSplits([], 1000), []);
});

test("countZeroPaceEvents: timestamp-gap path counts real stops", () => {
  // 1s spacing with one 60s wall-clock gap → exactly one pause (default 5s).
  const T0 = 1_785_832_123;
  const gaps = [0, 1, 2, 62, 63, 64];
  const pts: WorkoutTrackPoint[] = gaps.map((t, i) => ({
    elapsed_sec: i,
    timestamp_unix: T0 + t,
    distance_m: i * 5,
    heart_rate: 140,
    speed_ms: 3,
  }));
  assert.equal(countZeroPaceEvents(pts), 1);

  // A second 60s gap → two events (this is what drives the Tapasciata rule).
  const pts2 = [...pts, { elapsed_sec: 6, timestamp_unix: T0 + 124, distance_m: 35, heart_rate: 140, speed_ms: 3 }];
  assert.equal(countZeroPaceEvents(pts2), 2);
});

test("countZeroPaceEvents: falls back to the heuristic when timestamps are absent", () => {
  // No timestamp_unix → the elapsed_sec-gap branch of the heuristic applies.
  const elapsed = [0, 1, 2, 62, 63];
  const pts: WorkoutTrackPoint[] = elapsed.map((e) => ({
    elapsed_sec: e,
    timestamp_unix: null,
    distance_m: e * 5,
    heart_rate: 140,
    speed_ms: 3,
  }));
  assert.equal(countZeroPaceEvents(pts), 1);

  assert.equal(countZeroPaceEvents([]), 0);
  assert.equal(countZeroPaceEvents([pts[0]]), 0);
});
