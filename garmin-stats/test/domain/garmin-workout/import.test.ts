/**
 * test/domain/garmin-workout/import.test.ts (HRA-185)
 * Covers garminStepsToImportPreview(): the pure GarminWorkoutStep[] ->
 * ResolvedSegment[] preview transform, independent of any @garmin/fitsdk
 * bytes. Round-trip (export -> import) coverage lives in
 * test/integrations/garmin-workout.test.ts, since that's where actual FIT
 * bytes are produced and re-decoded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { garminStepsToImportPreview } from "../../../src/domain/garmin-workout/import.ts";
import type { GarminWorkoutStep } from "../../../src/domain/garmin-workout/types.ts";
import { progressionMarkerName } from "../../../src/domain/garmin-workout/types.ts";

function speedStep(messageIndex: number, overrides: Partial<GarminWorkoutStep> = {}): GarminWorkoutStep {
  return {
    messageIndex, intensity: "active", durationType: "distance", durationMeters: 1000,
    targetType: "speed", targetLowSpeedMps: 1000 / (256 * 1.02), targetHighSpeedMps: 1000 / (256 * 0.98),
    ...overrides,
  };
}

// ── continuous ───────────────────────────────────────────────────────────

test("a single continuous distance step with a custom speed band imports as one continuous segment, pace = midpoint of the two pace boundaries", () => {
  const lowSpeed = 1000 / (256 * 1.02); // faster bound
  const highSpeed = 1000 / (256 * 0.98); // slower bound... but bounds are named by speed, not pace
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, intensity: "active", durationType: "distance", durationMeters: 5000, targetType: "speed", targetLowSpeedMps: lowSpeed, targetHighSpeedMps: highSpeed },
  ]);
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 1);
  const [segment] = preview.segments;
  assert.equal(segment.type, "continuous");
  if (segment.type !== "continuous") throw new Error("unreachable");
  assert.equal(segment.target.kind, "distance");
  if (segment.target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.target.distance_m, 5000);
  // arithmetic midpoint of the two pace boundaries, not of the two speeds
  const expectedPace = (1000 / lowSpeed + 1000 / highSpeed) / 2;
  assert.ok(segment.resolved_pace_sec_per_km != null && Math.abs(segment.resolved_pace_sec_per_km - expectedPace) < 1e-9);
});

test("a duration-based continuous step imports with a duration target", () => {
  const preview = garminStepsToImportPreview([speedStep(0, { durationType: "time", durationMeters: undefined, durationSeconds: 1800 })]);
  assert.equal(preview.canApply, true);
  const [segment] = preview.segments;
  assert.equal(segment.type, "continuous");
  if (segment.type !== "continuous") throw new Error("unreachable");
  assert.equal(segment.target.kind, "duration");
});

// ── open rest ────────────────────────────────────────────────────────────

test("an open rest step imports as a rest_block segment", () => {
  const preview = garminStepsToImportPreview([{ messageIndex: 0, intensity: "rest", durationType: "open", targetType: "open" }]);
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 1);
  assert.equal(preview.segments[0].type, "rest_block");
});

// ── custom speed bound validation ───────────────────────────────────────

test("missing custom speed bounds produce a non-applicable preview, not guessed pace data", () => {
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, durationType: "distance", durationMeters: 5000, targetType: "speed" },
  ]);
  assert.equal(preview.canApply, false);
  assert.deepEqual(preview.segments, []);
  assert.ok(preview.warnings.some(w => w.code === "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS"));
});

test("non-positive custom speed bounds produce a non-applicable preview", () => {
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, durationType: "distance", durationMeters: 5000, targetType: "speed", targetLowSpeedMps: 0, targetHighSpeedMps: 4 },
  ]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS"));
});

test("reversed custom speed bounds (low >= high) produce a non-applicable preview", () => {
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, durationType: "distance", durationMeters: 5000, targetType: "speed", targetLowSpeedMps: 5, targetHighSpeedMps: 4 },
  ]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS"));
});

// ── messageIndex integrity ──────────────────────────────────────────────

test("a duplicate messageIndex produces a non-applicable preview with a structured warning", () => {
  const preview = garminStepsToImportPreview([speedStep(0), speedStep(0)]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "DUPLICATE_STEP_INDEX"));
});

test("a missing messageIndex produces a non-applicable preview with a structured warning", () => {
  const preview = garminStepsToImportPreview([speedStep(0), speedStep(2)]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "MISSING_STEP_INDEX"));
});

// ── repeat markers -> interval ───────────────────────────────────────────

test("a repeat marker over one work step imports as an interval with no rest", () => {
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, intensity: "interval", durationType: "distance", durationMeters: 3000, targetType: "speed", targetLowSpeedMps: 1000 / (230 * 1.02), targetHighSpeedMps: 1000 / (230 * 0.98) },
    { messageIndex: 1, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 0, repeatCount: 4, targetType: "open" },
  ]);
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 1);
  const [segment] = preview.segments;
  assert.equal(segment.type, "interval");
  if (segment.type !== "interval") throw new Error("unreachable");
  assert.equal(segment.reps, 4);
  assert.equal(segment.rest, undefined);
  assert.equal(segment.work_target.kind, "distance");
});

test("a repeat marker over a work + recovery pair imports as an interval with rest", () => {
  const preview = garminStepsToImportPreview([
    { messageIndex: 0, intensity: "interval", durationType: "distance", durationMeters: 3000, targetType: "speed", targetLowSpeedMps: 1000 / (230 * 1.02), targetHighSpeedMps: 1000 / (230 * 0.98) },
    { messageIndex: 1, intensity: "rest", durationType: "distance", durationMeters: 1000, targetType: "speed", targetLowSpeedMps: 1000 / (280 * 1.02), targetHighSpeedMps: 1000 / (280 * 0.98) },
    { messageIndex: 2, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 0, repeatCount: 4, targetType: "open" },
  ]);
  assert.equal(preview.canApply, true);
  const [segment] = preview.segments;
  assert.equal(segment.type, "interval");
  if (segment.type !== "interval") throw new Error("unreachable");
  assert.equal(segment.reps, 4);
  assert.ok(segment.rest != null);
  assert.equal(segment.rest?.target.kind, "distance");
});

test("an invalid back-reference (repeatFrom >= marker index) is unsupported", () => {
  const preview = garminStepsToImportPreview([
    speedStep(0),
    { messageIndex: 1, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 1, repeatCount: 4, targetType: "open" },
  ]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "INVALID_REPEAT_REFERENCE"));
});

test("a repeat body larger than 2 steps is unsupported", () => {
  const preview = garminStepsToImportPreview([
    speedStep(0), speedStep(1), speedStep(2),
    { messageIndex: 3, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 0, repeatCount: 4, targetType: "open" },
  ]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "UNSUPPORTED_REPEAT_BODY_SIZE"));
});

test("a nested repeat marker inside a repeat body is unsupported", () => {
  const preview = garminStepsToImportPreview([
    speedStep(0),
    { messageIndex: 1, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 0, repeatCount: 2, targetType: "open" },
    { messageIndex: 2, durationType: "repeatUntilStepsCmplt", repeatFromMessageIndex: 0, repeatCount: 4, targetType: "open" },
  ]);
  assert.equal(preview.canApply, false);
  assert.ok(preview.warnings.some(w => w.code === "NESTED_REPEAT"));
});

// ── progression marker collapse ─────────────────────────────────────────

function progressionStages(): GarminWorkoutStep[] {
  const paces = [300, 289, 278, 267, 256];
  return paces.map((pace, i) => ({
    messageIndex: i, intensity: "active", durationType: "distance", durationMeters: 2000,
    targetType: "speed", targetLowSpeedMps: 1000 / (pace * 1.02), targetHighSpeedMps: 1000 / (pace * 0.98),
    name: progressionMarkerName(0, i, 5),
  }));
}

test("5 stages carrying a complete, correctly-ordered HRA progression marker collapse into one progression segment", () => {
  const preview = garminStepsToImportPreview(progressionStages());
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 1);
  const [segment] = preview.segments;
  assert.equal(segment.type, "progression");
  if (segment.type !== "progression") throw new Error("unreachable");
  assert.equal(segment.target.kind, "distance");
  if (segment.target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.target.distance_m, 10000);
  assert.ok(preview.warnings.some(w => w.code === "IMPORTED_PROGRESSION_FROM_STAIRCASE"));
});

test("unmarked monotonic steps remain ordered continuous segments — the importer never guesses a progression", () => {
  const stages = progressionStages().map(s => ({ ...s, name: undefined }));
  const preview = garminStepsToImportPreview(stages);
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 5);
  assert.ok(preview.segments.every(s => s.type === "continuous"));
});

test("a partial (4 of 5) progression marker set does not collapse — falls back to continuous segments", () => {
  const stages = progressionStages().slice(0, 4);
  const preview = garminStepsToImportPreview(stages);
  assert.equal(preview.canApply, true);
  assert.equal(preview.segments.length, 4);
  assert.ok(preview.segments.every(s => s.type === "continuous"));
});

// ── malformed / empty ────────────────────────────────────────────────────

test("an empty step list is non-applicable", () => {
  const preview = garminStepsToImportPreview([]);
  assert.equal(preview.canApply, false);
  assert.deepEqual(preview.segments, []);
});
