/**
 * domain/outliers.test.ts  (HRA-69)
 * sampleGapSec (newly extracted, previously untested) + a smoke of the two
 * masks imported straight from domain. The exhaustive mask-behaviour cases
 * live in components/activity-outliers.test.ts (HRA-63), which now reaches
 * these same functions via ActivityModal's re-export.
 */
import { describe, it, expect } from "vitest";
import type { TrackPoint } from "@/types/api";
import { sampleGapSec, computeOutlierMask, computeMinSpeedMask } from "./outliers";

function pt(o: Partial<TrackPoint>): TrackPoint {
  return {
    elapsed_sec: null, timestamp_unix: null, distance_m: null, heart_rate: null,
    speed_ms: null, cadence: null, altitude_m: null, temperature: null, power: null, ...o,
  };
}

describe("sampleGapSec", () => {
  it("prefers timestamp_unix, falls back to elapsed_sec, else 1", () => {
    expect(sampleGapSec(pt({ timestamp_unix: 100 }), pt({ timestamp_unix: 130 }))).toBe(30);
    expect(sampleGapSec(pt({ elapsed_sec: 10 }), pt({ elapsed_sec: 25 }))).toBe(15);
    expect(sampleGapSec(pt({}), pt({}))).toBe(1);
  });
  it("never returns 0 (a same-timestamp pair floors to 1)", () => {
    expect(sampleGapSec(pt({ timestamp_unix: 100 }), pt({ timestamp_unix: 100 }))).toBe(1);
  });
});

describe("masks (domain import smoke)", () => {
  it("computeOutlierMask flags an isolated spike, spares a sustained change", () => {
    const track = (speeds: number[]) => speeds.map((s, i) => pt({ timestamp_unix: 1000 + i, speed_ms: s }));
    expect(computeOutlierMask(track([3, 3, 10, 3, 3]), p => p.speed_ms, 2)).toEqual([false, false, true, false, false]);
    expect(computeOutlierMask(track([3, 3, 6, 6, 6]), p => p.speed_ms, 2)).toEqual([false, false, false, false, false]);
  });
  it("computeMinSpeedMask drops samples below the km/h floor", () => {
    const track = [2, 1, 0.5, 3].map(s => pt({ speed_ms: s }));
    expect(computeMinSpeedMask(track, 6)).toEqual([false, true, true, false]); // 6km/h ≈ 1.667 m/s
  });
});
