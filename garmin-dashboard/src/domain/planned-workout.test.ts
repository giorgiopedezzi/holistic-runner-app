import { describe, expect, it } from "vitest";
import type { ResolvedSegment, Target } from "@/types/runplan";
import { buildPaceTargetBandModel, computePaceTargetStats, type PaceTargetBand } from "./planned-workout";

const distance = (distanceM: number): Target => ({ kind: "distance", distance_m: distanceM, raw: `${distanceM}m` });
const duration = (durationSec: number): Target => ({ kind: "duration", duration_sec: durationSec, raw: `${durationSec}s` });

describe("buildPaceTargetBandModel", () => {
  it("builds a continuous real-distance band with exact +/-2% pace bounds", () => {
    const segments: ResolvedSegment[] = [{
      type: "continuous", target: distance(5000), resolved_pace_sec_per_km: 300, raw: "5km @ 5:00/km",
    }];

    expect(buildPaceTargetBandModel(segments)).toEqual({
      totalDistanceM: 5000,
      pieces: [{
        kind: "band", startDistanceM: 0, endDistanceM: 5000,
        startTargetPaceSecPerKm: 300, endTargetPaceSecPerKm: 300,
        startPaceLowerSecPerKm: 294, startPaceUpperSecPerKm: 306,
        endPaceLowerSecPerKm: 294, endPaceUpperSecPerKm: 306,
      }],
    });
  });

  it("expands every interval work and paced recovery leg in execution order", () => {
    const segments: ResolvedSegment[] = [{
      type: "interval", reps: 2, work_target: distance(1000), work_resolved_pace_sec_per_km: 240,
      rest: { target: distance(500), resolved_pace_sec_per_km: 360, raw: "r:500m @ 6:00/km" },
      raw: "2x1km @ 4:00/km r:500m @ 6:00/km",
    }];

    const model = buildPaceTargetBandModel(segments);
    expect(model.pieces.map(piece => [piece.kind, piece.startDistanceM, piece.endDistanceM])).toEqual([
      ["band", 0, 1000],
      ["band", 1000, 1500],
      ["band", 1500, 2500],
      ["band", 2500, 3000],
    ]);
  });

  it("keeps a progression continuous from its resolved start range to its end range", () => {
    const segments: ResolvedSegment[] = [{
      type: "progression", target: distance(6000),
      start_resolved_pace_sec_per_km: 330, end_resolved_pace_sec_per_km: 270,
      raw: "6km PROG 5:30/km -> 4:30/km",
    }];

    const [piece] = buildPaceTargetBandModel(segments).pieces;
    expect(piece).toMatchObject({
      kind: "band", startDistanceM: 0, endDistanceM: 6000,
      startPaceLowerSecPerKm: 323.4, startPaceUpperSecPerKm: 336.6,
      endPaceLowerSecPerKm: 264.6, endPaceUpperSecPerKm: 275.4,
    });
  });

  it("converts a duration leg to distance only through its resolved pace", () => {
    const paced: ResolvedSegment = {
      type: "continuous", target: duration(600), resolved_pace_sec_per_km: 300, raw: "10min @ 5:00/km",
    };
    const unpaced: ResolvedSegment = {
      type: "continuous", target: duration(300), resolved_pace_sec_per_km: null, raw: "5min @ ?",
    };

    const model = buildPaceTargetBandModel([paced, unpaced]);
    expect(model.totalDistanceM).toBe(2000);
    expect(model.pieces.map(piece => [piece.kind, piece.startDistanceM, piece.endDistanceM])).toEqual([
      ["band", 0, 2000],
      ["gap", 2000, 2000],
    ]);
  });

  it("preserves known unpaced distance as a gap and never invents unknown width", () => {
    const segments: ResolvedSegment[] = [
      { type: "continuous", target: distance(1000), resolved_pace_sec_per_km: 300, raw: "1km @ 5:00/km" },
      { type: "rest_block", target: distance(400), rest_type: "walk", raw: "400m walk" },
      { type: "continuous", target: { kind: "unknown", raw: "?" }, resolved_pace_sec_per_km: 300, raw: "? @ 5:00/km" },
      { type: "continuous", target: distance(1000), resolved_pace_sec_per_km: 270, raw: "1km @ 4:30/km" },
    ];

    const model = buildPaceTargetBandModel(segments);
    expect(model.totalDistanceM).toBe(2400);
    expect(model.pieces.map(piece => [piece.kind, piece.startDistanceM, piece.endDistanceM])).toEqual([
      ["band", 0, 1000],
      ["gap", 1000, 1400],
      ["gap", 1400, 1400],
      ["band", 1400, 2400],
    ]);
  });

  it("computes the workout-wide mean by real planned distance for ramp normalization", () => {
    const model = buildPaceTargetBandModel([
      { type: "continuous", target: distance(1000), resolved_pace_sec_per_km: 300, raw: "1km @ 5:00/km" },
      { type: "continuous", target: distance(3000), resolved_pace_sec_per_km: 240, raw: "3km @ 4:00/km" },
    ]);
    const bands = model.pieces.filter((piece): piece is PaceTargetBand => piece.kind === "band");

    expect(computePaceTargetStats(bands)).toEqual({
      fastestPaceSecPerKm: 240,
      meanPaceSecPerKm: 255,
      slowestPaceSecPerKm: 300,
    });
  });
});
