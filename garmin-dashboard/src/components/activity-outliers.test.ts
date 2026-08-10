/**
 * src/components/activity-outliers.test.ts  (HRA-63)
 * The two pure outlier-mask rules from ActivityModal (exported for testing).
 * These encode a subtle, repeatedly-fixed intent: flag isolated spikes but
 * NEVER a genuine sustained change (see CLAUDE.md's activity-detail notes).
 */
import { describe, it, expect } from "vitest";
import { computeOutlierMask, computeMinSpeedMask } from "./ActivityModal";
import type { TrackPoint } from "@/types/api";

function track(speeds: (number | null)[]): TrackPoint[] {
  const T0 = 1_785_832_123;
  return speeds.map((speed_ms, i) => ({
    elapsed_sec: i,
    timestamp_unix: T0 + i, // 1s apart → rate == raw delta
    distance_m: i * 3,
    heart_rate: 150,
    speed_ms,
    cadence: null,
    altitude_m: null,
    temperature: null,
    power: null,
  }));
}

describe("computeOutlierMask (isolated-spike delta rule)", () => {
  it("flags an isolated spike (jumps away and immediately back)", () => {
    const mask = computeOutlierMask(track([3, 3, 10, 3, 3]), (p) => p.speed_ms, 2);
    expect(mask).toEqual([false, false, true, false, false]);
  });

  it("does NOT flag a genuine sustained change (a real sprint)", () => {
    const mask = computeOutlierMask(track([3, 3, 6, 6, 6]), (p) => p.speed_ms, 2);
    expect(mask).toEqual([false, false, false, false, false]);
  });

  it("is a no-op when the threshold is not positive", () => {
    const mask = computeOutlierMask(track([3, 10, 3]), (p) => p.speed_ms, 0);
    expect(mask).toEqual([false, false, false]);
  });
});

describe("computeMinSpeedMask (absolute walking-pace floor)", () => {
  it("flags samples below the km/h floor (6 km/h ≈ 1.667 m/s)", () => {
    const mask = computeMinSpeedMask(track([2, 1, 0.5, 3]), 6);
    expect(mask).toEqual([false, true, true, false]);
  });

  it("is a no-op when the floor is 0", () => {
    const mask = computeMinSpeedMask(track([0.1, 0.2]), 0);
    expect(mask).toEqual([false, false]);
  });
});
