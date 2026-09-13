import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalQualityStructure, classifyQualityWorkout } from "../../../src/domain/reporting/quality-workout.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";

const dist = (m: number): { kind: "distance"; distance_m: number; raw: string } => ({ kind: "distance", distance_m: m, raw: `${m}m` });

test("classifyQualityWorkout: an interval segment with no category tag defaults to 'repetition'", () => {
  const segments: ResolvedSegment[] = [
    { type: "interval", reps: 8, work_target: dist(400), work_resolved_pace_sec_per_km: 240, raw: "8x400m @ RG-20" },
  ];
  assert.equal(classifyQualityWorkout({ segments }), "repetition");
});

test("classifyQualityWorkout: an interval segment tagged 'threshold' classifies as 'threshold'", () => {
  const segments: ResolvedSegment[] = [
    { type: "interval", reps: 3, work_target: dist(2000), work_resolved_pace_sec_per_km: 260, raw: "3x2000m @ FL" },
  ];
  assert.equal(classifyQualityWorkout({ category: "threshold", segments }), "threshold");
});

test("classifyQualityWorkout: a single progression segment classifies as 'progressive'", () => {
  const segments: ResolvedSegment[] = [
    { type: "progression", target: dist(5000), start_resolved_pace_sec_per_km: 300, end_resolved_pace_sec_per_km: 270, raw: "5km PROG RG -> RG-30" },
  ];
  assert.equal(classifyQualityWorkout({ segments }), "progressive");
});

test("classifyQualityWorkout: a single continuous segment classifies as 'tempo'", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(6000), resolved_pace_sec_per_km: 270, raw: "6km @ FL" },
  ];
  assert.equal(classifyQualityWorkout({ segments }), "tempo");
});

test("classifyQualityWorkout: multiple continuous legs WITHOUT a progressive category tag is not classified (never invented)", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 300, raw: "2km @ RG" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 270, raw: "2km @ RG-30" },
  ];
  assert.equal(classifyQualityWorkout({ segments }), null);
});

test("classifyQualityWorkout: multiple continuous legs WITH a 'progression' category tag classifies as 'progressive'", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 300, raw: "2km @ RG" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 270, raw: "2km @ RG-30" },
  ];
  assert.equal(classifyQualityWorkout({ category: "progression", segments }), "progressive");
});

test("classifyQualityWorkout: a plain rest_block only (no work) is not a quality workout", () => {
  const segments: ResolvedSegment[] = [{ type: "rest_block", target: dist(0), raw: "REST" }];
  assert.equal(classifyQualityWorkout({ segments }), null);
});

test("buildCanonicalQualityStructure: repetition expands EACH rep into its own work+recovery entry", () => {
  const segments: ResolvedSegment[] = [
    {
      type: "interval", reps: 3, work_target: dist(400), work_resolved_pace_sec_per_km: 240,
      rest: { target: dist(200), resolved_pace_sec_per_km: 360, raw: "r:200m @ RG+120" },
      raw: "3x400m @ RG-20 r:200m @ RG+120",
    },
  ];
  const structure = buildCanonicalQualityStructure({ segments });
  assert.ok(structure);
  assert.equal(structure.kind, "repetition");
  assert.equal(structure.segments.length, 6); // 3 work + 3 recovery, interleaved
  assert.deepEqual(structure.segments.map(s => s.role), ["work", "recovery", "work", "recovery", "work", "recovery"]);
  const work = structure.segments.filter(s => s.role === "work");
  for (const w of work) {
    assert.equal(w.targetDistanceM, 400);
    assert.equal(w.targetPaceSecPerKm, 240);
  }
  // indices are stable/sequential across the whole structure, not per-role
  assert.deepEqual(structure.segments.map(s => s.index), [0, 1, 2, 3, 4, 5]);
});

test("buildCanonicalQualityStructure: repetition with no rest clause produces work-only entries", () => {
  const segments: ResolvedSegment[] = [
    { type: "interval", reps: 2, work_target: dist(1000), work_resolved_pace_sec_per_km: 250, raw: "2x1000m @ RG-10" },
  ];
  const structure = buildCanonicalQualityStructure({ segments });
  assert.ok(structure);
  assert.equal(structure.segments.length, 2);
  assert.ok(structure.segments.every(s => s.role === "work"));
});

test("buildCanonicalQualityStructure: tempo produces a single work entry for the whole continuous block", () => {
  const segments: ResolvedSegment[] = [{ type: "continuous", target: dist(6000), resolved_pace_sec_per_km: 270, raw: "6km @ FL" }];
  const structure = buildCanonicalQualityStructure({ segments });
  assert.ok(structure);
  assert.equal(structure.kind, "tempo");
  assert.equal(structure.segments.length, 1);
  assert.equal(structure.segments[0].targetDistanceM, 6000);
});

test("buildCanonicalQualityStructure: progressive (single PROG segment) carries distinct start/end target pace on one phase", () => {
  const segments: ResolvedSegment[] = [
    { type: "progression", target: dist(5000), start_resolved_pace_sec_per_km: 300, end_resolved_pace_sec_per_km: 270, raw: "5km PROG RG -> RG-30" },
  ];
  const structure = buildCanonicalQualityStructure({ segments });
  assert.ok(structure);
  assert.equal(structure.segments.length, 1);
  assert.equal(structure.segments[0].targetPaceSecPerKm, 300);
  assert.equal(structure.segments[0].targetPaceSecPerKmEnd, 270);
});

test("buildCanonicalQualityStructure: progressive (multi-leg, tagged) produces one phase per continuous leg", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 300, raw: "2km @ RG" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 270, raw: "2km @ RG-30" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 240, raw: "2km @ RG-60" },
  ];
  const structure = buildCanonicalQualityStructure({ category: "progression", segments });
  assert.ok(structure);
  assert.equal(structure.segments.length, 3);
  assert.deepEqual(structure.segments.map(s => s.targetPaceSecPerKm), [300, 270, 240]);
});

test("buildCanonicalQualityStructure: returns null for an unclassified day", () => {
  const segments: ResolvedSegment[] = [{ type: "rest_block", target: dist(0), raw: "REST" }];
  assert.equal(buildCanonicalQualityStructure({ segments }), null);
});
