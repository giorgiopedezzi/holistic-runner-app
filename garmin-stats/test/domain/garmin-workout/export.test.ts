/**
 * test/domain/garmin-workout/export.test.ts (HRA-184)
 * Covers resolvedDayToGarminSteps(): the pure ResolvedDay -> GarminWorkoutStep[]
 * transform, independent of any @garmin/fitsdk bytes. The re-decode assertions
 * required by the Story's acceptance criteria live in
 * test/integrations/garmin-workout.test.ts instead, since only that layer
 * touches the SDK.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayEntry } from "../../../src/domain/runplan/parser.ts";
import { resolveDay } from "../../../src/domain/runplan/instantiate.ts";
import type { ResolvedDay } from "../../../src/domain/runplan/instantiate.ts";
import type { DayParseContext, PacePolicy } from "../../../src/domain/runplan/types.ts";
import { resolvedDayToGarminSteps } from "../../../src/domain/garmin-workout/export.ts";
import { PACE_ALERT_BAND_POLICY } from "../../../src/domain/garmin-workout/types.ts";

const POLICY: PacePolicy = {
  RG: { kind: "absolute", pace_sec_per_km: 256 },
  FL: { kind: "absolute", pace_sec_per_km: 300 },
};

const CTX: DayParseContext = {
  unit: "km", offset_unit: "s/km", default_rest: "jog", pacePolicy: POLICY,
  allowUnboundPace: false,
};

function resolve(raw: string): ResolvedDay {
  const day = parseDayEntry(raw, CTX);
  return resolveDay(day, "Base", 1, "2026-01-05", POLICY);
}

// ── continuous ───────────────────────────────────────────────────────────

test("continuous distance segment exports one active step with the resolved pace band", () => {
  const day = resolve("D1: 10km @ RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 1);
  const [step] = result.steps;
  assert.equal(step.intensity, "active");
  assert.equal(step.durationType, "distance");
  assert.equal(step.durationMeters, 10000);
  assert.equal(step.targetType, "speed");
  const low = 1000 / (256 * 1.02);
  const high = 1000 / (256 * 0.98);
  assert.ok(Math.abs((step.targetLowSpeedMps ?? 0) - low) < 1e-9);
  assert.ok(Math.abs((step.targetHighSpeedMps ?? 0) - high) < 1e-9);
});

test("continuous duration segment exports a time-based step", () => {
  const day = resolve("D1: 40min @ RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps[0].durationType, "time");
  assert.equal(result.steps[0].durationSeconds, 2400);
});

// ── intervals ────────────────────────────────────────────────────────────

test("interval with rest exports work, rest, and a repeat marker referencing the work step", () => {
  const day = resolve("D1: 4x3000m @ RG-20 r:1km @ RG+10");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 3);

  const [work, rest, marker] = result.steps;
  assert.equal(work.intensity, "interval");
  assert.equal(work.durationType, "distance");
  assert.equal(work.durationMeters, 3000);

  assert.equal(rest.intensity, "rest");
  assert.equal(rest.durationType, "distance");
  assert.equal(rest.durationMeters, 1000);

  assert.equal(marker.durationType, "repeatUntilStepsCmplt");
  assert.equal(marker.repeatFromMessageIndex, work.messageIndex);
  assert.equal(marker.repeatCount, 4);
  assert.equal(marker.messageIndex, 2);
});

test("interval without rest exports a work step and a repeat marker only", () => {
  // A rest-less interval always sets DayEntry.needs_review: true at parse
  // time (HRA-113), so it can never reach the exporter through the normal
  // parse -> resolveDay pipeline (it is correctly stopped by the NEEDS_REVIEW
  // gate first). Building the ResolvedDay by hand isolates the exporter's own
  // structural mapping for this shape, per the ADR's "IntervalSegment without
  // rest" row.
  const day: ResolvedDay = {
    section_name: "Base", week_number: 1, date: "2026-01-05", day: 1,
    workout_type: "run", needs_review: false,
    segments: [{
      type: "interval", reps: 4,
      work_target: { kind: "distance", distance_m: 3000, raw: "3000m" },
      work_resolved_pace_sec_per_km: 236,
      raw: "4x3000m @ RG-20",
    }],
  };
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].durationType, "repeatUntilStepsCmplt");
  assert.equal(result.steps[1].repeatFromMessageIndex, 0);
  assert.equal(result.steps[1].repeatCount, 4);
});

test("interval rest leg with no intensity exports as an open rest step, not an error", () => {
  const day = resolve("D1: 8x500m @ RG-40 r:90s stand");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const [, rest] = result.steps;
  assert.equal(rest.targetType, "open");
  assert.equal(rest.durationType, "time");
  assert.equal(rest.durationSeconds, 90);
});

// ── rest ─────────────────────────────────────────────────────────────────

test("a whole-day REST (no segments) exports a single open rest step", () => {
  const day = resolve("D1: REST");
  assert.equal(day.workout_type, "rest");
  assert.equal(day.segments.length, 0);
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].intensity, "rest");
  assert.equal(result.steps[0].durationType, "open");
  assert.equal(result.steps[0].targetType, "open");
});

test("a rest_block with an unresolved (unknown) target exports as an open rest step", () => {
  const day: ResolvedDay = {
    section_name: "Base", week_number: 1, date: "2026-01-05", day: 4,
    workout_type: "rest", needs_review: false,
    segments: [{ type: "rest_block", target: { kind: "unknown", raw: "" }, rest_type: "jog", raw: "REST" }],
  };
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].durationType, "open");
  assert.equal(result.steps[0].intensity, "rest");
});

test("a rest_block with a resolved distance target exports a distance-bound rest step", () => {
  const day = resolve("D1: 5000m @ RG-20 ; REST 4min stand");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].intensity, "rest");
  assert.equal(result.steps[1].durationType, "time");
  assert.equal(result.steps[1].durationSeconds, 240);
});

// ── explicit progression (quantized to 5 stages) ────────────────────────

test("an explicit progression segment becomes exactly 5 stages with interpolated paces including both endpoints", () => {
  const day = resolve("D1: 10km PROG FL->RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 5);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "LOSSY_PROGRESSION_STAIRCASE");
  assert.equal(result.warnings[0].stepIndex, 0);

  const totalMeters = result.steps.reduce((sum, step) => sum + (step.durationMeters ?? 0), 0);
  assert.equal(totalMeters, 10000);

  const startPace = 300; // FL
  const endPace = 256; // RG
  for (const [i, step] of result.steps.entries()) {
    const expectedPace = startPace + ((endPace - startPace) * i) / 4;
    const expectedLow = 1000 / (expectedPace * 1.02);
    assert.ok(step.targetLowSpeedMps != null && Math.abs(step.targetLowSpeedMps - expectedLow) < 1e-6);
  }
});

// HRA-185: the exporter must tag each progression stage with a deterministic
// marker so the importer can safely collapse it back, without guessing at
// unmarked monotonic steps from any other producer (ADR §4.5).
test("a progression's 5 stages carry a deterministic HRA progression marker in wktStepName order", () => {
  const day = resolve("D1: 10km PROG FL->RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.deepEqual(
    result.steps.map(s => s.name),
    ["HRA:PROG:0:0/5", "HRA:PROG:0:1/5", "HRA:PROG:0:2/5", "HRA:PROG:0:3/5", "HRA:PROG:0:4/5"],
  );
});

test("progression stage distances stay within one FIT profile unit (0.01m) of an exact 5-way split", () => {
  const day = resolve("D1: 10001m PROG FL->RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const totalMeters = result.steps.reduce((sum, step) => sum + (step.durationMeters ?? 0), 0);
  assert.ok(Math.abs(totalMeters - 10001) < 0.01);
});

// ── already-staged continuous workouts (HRA-183's "progressive" shape) ──

test("multiple manually-staged continuous segments export one step each, with no lossy-progression warning", () => {
  const day = resolve("D1: 2km @ RG-30 ; 2km @ RG-15 ; 2km @ RG");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.steps.every(step => step.intensity === "active" && step.durationType === "distance"));
});

// ── rejected inputs ──────────────────────────────────────────────────────

test("a needs_review day is rejected with a structured error and no steps", () => {
  const day = resolve("D1: TODO");
  assert.equal(day.needs_review, true);
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.errors.some(e => e.code === "NEEDS_REVIEW"));
});

test("an unsupported workout type (cross) is rejected", () => {
  const day = resolve("D1: CROSS 45min bike");
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_WORKOUT_TYPE"));
});

test("a continuous segment with an unresolved pace (hand-built ResolvedDay) is rejected, never silently exported", () => {
  const day: ResolvedDay = {
    section_name: "Base", week_number: 1, date: "2026-01-05", day: 1,
    workout_type: "run", needs_review: false,
    segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: null, raw: "5km @ ?" }],
  };
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.errors.some(e => e.code === "UNRESOLVED_PACE"));
});

test("a continuous segment with an unknown target (hand-built ResolvedDay) is rejected", () => {
  const day: ResolvedDay = {
    section_name: "Base", week_number: 1, date: "2026-01-05", day: 1,
    workout_type: "run", needs_review: false,
    segments: [{ type: "continuous", target: { kind: "unknown", raw: "?" }, resolved_pace_sec_per_km: 256, raw: "? @ RG" }],
  };
  const result = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.ok(result.errors.some(e => e.code === "UNKNOWN_TARGET"));
});

// ── determinism ──────────────────────────────────────────────────────────

test("exporting the same day twice produces identical steps and warnings", () => {
  const day = resolve("D1: 4x3000m @ RG-20 r:1km @ RG+10 ; 10km PROG FL->RG");
  const first = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  const second = resolvedDayToGarminSteps(day, PACE_ALERT_BAND_POLICY);
  assert.deepEqual(first, second);
});
