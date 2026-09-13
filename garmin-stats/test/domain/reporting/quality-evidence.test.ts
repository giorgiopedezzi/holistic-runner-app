import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStructuredQualityComparison, type ManualSegmentAlignment } from "../../../src/domain/reporting/quality-evidence.ts";
import { buildCanonicalQualityStructure } from "../../../src/domain/reporting/quality-workout.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";

const dist = (m: number): { kind: "distance"; distance_m: number; raw: string } => ({ kind: "distance", distance_m: m, raw: `${m}m` });

const repetitionSegments: ResolvedSegment[] = [
  {
    type: "interval", reps: 3, work_target: dist(1000), work_resolved_pace_sec_per_km: 240,
    rest: { target: dist(200), resolved_pace_sec_per_km: 400, raw: "r:200m @ RG+160" },
    raw: "3x1000m @ RG-20 r:200m @ RG+160",
  },
];

test("no evidence at all: every segment 'unavailable', report not available, planned totals still truthful", () => {
  const structure = buildCanonicalQualityStructure({ segments: repetitionSegments })!;
  const result = buildStructuredQualityComparison(structure, {}, 280);
  assert.equal(result.available, false);
  assert.ok(result.segments.every(s => s.actual.provenance === "unavailable"));
  assert.equal(result.totals.plannedWorkDistanceM, 3000);
  assert.equal(result.totals.actualWorkDistanceM, 0);
  assert.equal(result.totals.coverage.totalWorkSegments, 3);
  assert.equal(result.totals.coverage.alignedWorkSegments, 0);
  assert.equal(result.wholeSessionPaceSecPerKm, 280);
});

test("manual alignment on some (not all) work reps: partial coverage, totals over aligned reps only", () => {
  const structure = buildCanonicalQualityStructure({ segments: repetitionSegments })!;
  // work segments land at indices 0, 2, 4 (recovery at 1, 3, 5)
  const manual: ManualSegmentAlignment[] = [
    { segmentIndex: 0, activityId: 42, distanceM: 1000, durationSec: 230 },
    { segmentIndex: 4, activityId: 42, distanceM: 1000, durationSec: 250 },
  ];
  const result = buildStructuredQualityComparison(structure, { manual }, 280);
  assert.equal(result.available, true);
  assert.equal(result.totals.coverage.totalWorkSegments, 3);
  assert.equal(result.totals.coverage.alignedWorkSegments, 2);
  assert.equal(result.totals.actualWorkDistanceM, 2000);
  assert.equal(result.totals.actualWorkDurationSec, 480);
  // weighted pace = 480s / 2km = 240 sec/km
  assert.equal(result.totals.weightedActualPaceSecPerKm, 240);
  // fastest = 230s/km, slowest = 250s/km
  assert.deepEqual(result.totals.paceSpreadSecPerKm, { fastest: 230, slowest: 250 });
  const workAtIndex0 = result.segments.find(s => s.segment.index === 0)!;
  assert.equal(workAtIndex0.actual.provenance, "manual");
  assert.equal(workAtIndex0.actual.activityId, 42);
  const recoveryAtIndex1 = result.segments.find(s => s.segment.index === 1)!;
  assert.equal(recoveryAtIndex1.actual.provenance, "unavailable"); // recovery was never manually aligned
});

test("executed-step evidence outranks lap evidence, which outranks manual, for the same segment", () => {
  const structure = buildCanonicalQualityStructure({ segments: repetitionSegments })!;
  const result = buildStructuredQualityComparison(structure, {
    executedSteps: [{ segmentIndex: 0, distanceM: 1000, durationSec: 235 }],
    laps: [{ segmentIndex: 0, distanceM: 1000, durationSec: 220 }],
    manual: [{ segmentIndex: 0, activityId: 1, distanceM: 1000, durationSec: 200 }],
  }, null);
  const seg0 = result.segments.find(s => s.segment.index === 0)!;
  assert.equal(seg0.actual.provenance, "executed_step");
  assert.equal(seg0.actual.durationSec, 235);
});

test("lap evidence outranks manual when no executed step exists for that segment", () => {
  const structure = buildCanonicalQualityStructure({ segments: repetitionSegments })!;
  const result = buildStructuredQualityComparison(structure, {
    laps: [{ segmentIndex: 0, distanceM: 1000, durationSec: 220 }],
    manual: [{ segmentIndex: 0, activityId: 1, distanceM: 1000, durationSec: 200 }],
  }, null);
  const seg0 = result.segments.find(s => s.segment.index === 0)!;
  assert.equal(seg0.actual.provenance, "lap");
  assert.equal(seg0.actual.durationSec, 220);
});

test("progressive: consecutive aligned phases getting faster reports progressivelyFaster true", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 300, raw: "2km @ RG" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 270, raw: "2km @ RG-30" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 240, raw: "2km @ RG-60" },
  ];
  const structure = buildCanonicalQualityStructure({ category: "progression", segments })!;
  const manual: ManualSegmentAlignment[] = [
    { segmentIndex: 0, activityId: 1, distanceM: 2000, durationSec: 600 }, // 300 sec/km
    { segmentIndex: 1, activityId: 1, distanceM: 2000, durationSec: 560 }, // 280 sec/km
    { segmentIndex: 2, activityId: 1, distanceM: 2000, durationSec: 500 }, // 250 sec/km
  ];
  const result = buildStructuredQualityComparison(structure, { manual }, null);
  assert.equal(result.totals.progressivelyFaster, true);
});

test("progressive: a phase that isn't faster than the previous one reports progressivelyFaster false", () => {
  const segments: ResolvedSegment[] = [
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 300, raw: "2km @ RG" },
    { type: "continuous", target: dist(2000), resolved_pace_sec_per_km: 270, raw: "2km @ RG-30" },
  ];
  const structure = buildCanonicalQualityStructure({ category: "progression", segments })!;
  const manual: ManualSegmentAlignment[] = [
    { segmentIndex: 0, activityId: 1, distanceM: 2000, durationSec: 560 }, // 280 sec/km
    { segmentIndex: 1, activityId: 1, distanceM: 2000, durationSec: 600 }, // 300 sec/km — slower, not faster
  ];
  const result = buildStructuredQualityComparison(structure, { manual }, null);
  assert.equal(result.totals.progressivelyFaster, false);
});

test("progressive: fewer than 2 aligned phases reports progressivelyFaster null, never a fabricated verdict", () => {
  const segments: ResolvedSegment[] = [
    { type: "progression", target: dist(5000), start_resolved_pace_sec_per_km: 300, end_resolved_pace_sec_per_km: 270, raw: "5km PROG RG -> RG-30" },
  ];
  const structure = buildCanonicalQualityStructure({ segments })!;
  const result = buildStructuredQualityComparison(structure, {}, null);
  assert.equal(result.totals.progressivelyFaster, null);
});

test("repetition kind: pace spread is null (not fabricated) when fewer than 2 reps are aligned", () => {
  const structure = buildCanonicalQualityStructure({ segments: repetitionSegments })!;
  const manual: ManualSegmentAlignment[] = [{ segmentIndex: 0, activityId: 1, distanceM: 1000, durationSec: 240 }];
  const result = buildStructuredQualityComparison(structure, { manual }, null);
  assert.equal(result.totals.paceSpreadSecPerKm, null);
});

test("tempo/threshold kinds never populate paceSpreadSecPerKm even with multiple aligned segments", () => {
  const segments: ResolvedSegment[] = [
    { type: "interval", reps: 2, work_target: dist(2000), work_resolved_pace_sec_per_km: 260, raw: "2x2000m @ FL" },
  ];
  const structure = buildCanonicalQualityStructure({ category: "threshold", segments })!;
  const manual: ManualSegmentAlignment[] = [
    { segmentIndex: 0, activityId: 1, distanceM: 2000, durationSec: 500 },
    { segmentIndex: 1, activityId: 1, distanceM: 2000, durationSec: 520 },
  ];
  const result = buildStructuredQualityComparison(structure, { manual }, null);
  assert.equal(result.kind, "threshold");
  assert.equal(result.totals.paceSpreadSecPerKm, null);
});
