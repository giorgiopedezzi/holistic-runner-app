/**
 * test/integrations/garmin-workout.test.ts (HRA-184)
 * Re-decodes every FIT binary this Story's exporter produces and asserts
 * against the DECODED profile fields, not the write-side domain objects —
 * per the Story's acceptance criteria, a silently dropped or misspelled
 * @garmin/fitsdk field name must fail verification here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayEntry } from "../../src/domain/runplan/parser.ts";
import { resolveDay } from "../../src/domain/runplan/instantiate.ts";
import type { ResolvedDay } from "../../src/domain/runplan/instantiate.ts";
import type { DayParseContext, PacePolicy } from "../../src/domain/runplan/types.ts";
import { decodeGarminWorkoutFit, scheduledTimeToDate, toGarminSchedulesFit, toGarminWorkoutFit } from "../../src/integrations/garmin-workout.ts";

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

function resolveAt(raw: string, date: string): ResolvedDay {
  const day = parseDayEntry(raw, CTX);
  return resolveDay(day, "Base", 1, date, POLICY);
}

interface DecodedWorkoutStep {
  messageIndex: number;
  durationType: string;
  durationValue?: number; // raw wire units (@garmin/fitsdk's base-field scale — see integrations/garmin-workout.ts)
  durationDistance?: number; // expanded subfield, real meters
  durationTime?: number; // expanded subfield, real seconds
  durationStep?: number; // expanded subfield, messageIndex to loop back to
  targetType: string;
  targetValue?: number; // raw wire units
  repeatSteps?: number; // expanded subfield, repeat count
  customTargetValueLow?: number; // raw wire units
  customTargetValueHigh?: number; // raw wire units
  customTargetSpeedLow?: number; // expanded subfield, real m/s
  customTargetSpeedHigh?: number; // expanded subfield, real m/s
  intensity?: string;
}

function decodeSteps(bytes: Buffer): DecodedWorkoutStep[] {
  const { messages, errors } = decodeGarminWorkoutFit(bytes);
  assert.deepEqual(errors, []);
  return (messages.workoutStepMesgs ?? []) as DecodedWorkoutStep[];
}

test("continuous distance segment round-trips through encode+decode with the exact File Id, Workout, and Workout Step messages", () => {
  const day = resolve("D1: 10km @ RG");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");

  const { messages, errors } = decodeGarminWorkoutFit(outcome.bytes);
  assert.deepEqual(errors, []);

  const [fileId] = messages.fileIdMesgs as Array<{ type: string }>;
  assert.equal(fileId.type, "workout");

  const [workout] = messages.workoutMesgs as Array<{ numValidSteps: number; sport: string }>;
  assert.equal(workout.numValidSteps, 1);
  assert.equal(workout.sport, "running");

  const [step] = decodeSteps(outcome.bytes);
  assert.equal(step.durationType, "distance");
  // @garmin/fitsdk expands the durationDistance subfield into real meters
  // (scale 100) alongside the raw durationValue wire int.
  assert.ok(Math.abs((step.durationDistance ?? 0) - 10000) < 0.01);
  assert.equal(step.targetType, "speed");
  assert.equal(step.intensity, "active");
  // HRA-392: targetValue (field 4's "targetSpeedZone" subfield) must decode
  // as 0 ("Custom"), not undefined — a device round-trip only the SDK's own
  // decoder round-trip test misses, since it doesn't validate this field at
  // all. This is the exact field the Forerunner 965 needs to recognize the
  // custom low/high band below as an active target instead of "no target".
  assert.equal(step.targetValue, 0);

  const expectedLow = 1000 / (256 * 1.02);
  const expectedHigh = 1000 / (256 * 0.98);
  assert.ok(Math.abs((step.customTargetSpeedLow ?? 0) - expectedLow) < 0.001);
  assert.ok(Math.abs((step.customTargetSpeedHigh ?? 0) - expectedHigh) < 0.001);
});

test("interval with recovery decodes to a work step, a rest step, and a correct repeat marker", () => {
  const day = resolve("D1: 4x3000m @ RG-20 r:1km @ RG+10");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");

  const steps = decodeSteps(outcome.bytes);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].intensity, "interval");
  assert.equal(steps[0].targetType, "speed");
  // HRA-392: the work leg's speed target must carry targetValue = 0 (Custom)
  // just like the continuous case above — a repeat's work leg is exactly
  // the kind of step the reported device bug (5:31/km showing "no target")
  // came from.
  assert.equal(steps[0].targetValue, 0);
  assert.equal(steps[1].intensity, "rest");
  assert.equal(steps[2].durationType, "repeatUntilStepsCmplt");
  assert.equal(steps[2].durationValue, steps[0].messageIndex);
  assert.equal(steps[2].targetValue, 4);
});

test("interval without recovery decodes to a work step and a repeat marker only", () => {
  const day: ResolvedDay = {
    section_name: "Base", week_number: 1, date: "2026-01-05", day: 1,
    workout_type: "run", needs_review: false,
    segments: [{
      type: "interval", reps: 6,
      work_target: { kind: "duration", duration_sec: 120, raw: "2min" },
      work_resolved_pace_sec_per_km: 220,
      raw: "6x2min @ FL",
    }],
  };
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");

  const steps = decodeSteps(outcome.bytes);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].durationType, "time");
  assert.ok(Math.abs((steps[0].durationTime ?? 0) - 120) < 0.001);
  assert.equal(steps[1].durationType, "repeatUntilStepsCmplt");
  assert.equal(steps[1].durationValue, 0);
  assert.equal(steps[1].targetValue, 6);
});

test("an explicit progression decodes to 5 stages with the correct numValidSteps and a lossy-progression warning", () => {
  const day = resolve("D1: 10km PROG FL->RG");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.warnings.length, 1);
  assert.equal(outcome.warnings[0].code, "LOSSY_PROGRESSION_STAIRCASE");

  const [workout] = (decodeGarminWorkoutFit(outcome.bytes).messages.workoutMesgs ?? []) as Array<{ numValidSteps: number }>;
  assert.equal(workout.numValidSteps, 5);

  const steps = decodeSteps(outcome.bytes);
  assert.equal(steps.length, 5);
  const totalMeters = steps.reduce((sum, s) => sum + (s.durationDistance ?? 0), 0);
  assert.ok(Math.abs(totalMeters - 10000) < 0.02);
});

// HRA-185: wktStepName round-trips through the wire so the importer can
// detect the exporter's deterministic progression marker.
test("a progression's stage steps decode with the HRA progression marker in wktStepName", () => {
  const day = resolve("D1: 10km PROG FL->RG");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");
  const steps = decodeSteps(outcome.bytes) as Array<DecodedWorkoutStep & { wktStepName?: string }>;
  assert.deepEqual(
    steps.map(s => s.wktStepName),
    ["HRA:PROG:0:0/5", "HRA:PROG:0:1/5", "HRA:PROG:0:2/5", "HRA:PROG:0:3/5", "HRA:PROG:0:4/5"],
  );
});

test("already-staged continuous workouts decode as N plain steps with no warnings", () => {
  const day = resolve("D1: 2km @ RG-30 ; 2km @ RG-15 ; 2km @ RG");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");
  assert.deepEqual(outcome.warnings, []);
  const steps = decodeSteps(outcome.bytes);
  assert.equal(steps.length, 3);
  assert.ok(steps.every(s => s.durationType === "distance" && s.intensity === "active"));
});

test("a rest day (no segments) decodes to a single open rest step", () => {
  const day = resolve("D1: REST");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");
  const steps = decodeSteps(outcome.bytes);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].intensity, "rest");
  assert.equal(steps[0].durationType, "open");
  assert.equal(steps[0].targetType, "open");
});

test("needs_review days and unsupported workout types return structured errors and no bytes", () => {
  const todo = toGarminWorkoutFit(resolve("D1: TODO"));
  assert.equal(todo.ok, false);
  if (todo.ok) throw new Error("unreachable");
  assert.ok(todo.errors.some(e => e.code === "NEEDS_REVIEW"));
  assert.equal("bytes" in todo, false);

  const strength = toGarminWorkoutFit(resolve("D1: STRENGTH 30min core"));
  assert.equal(strength.ok, false);
  if (strength.ok) throw new Error("unreachable");
  assert.ok(strength.errors.some(e => e.code === "UNSUPPORTED_WORKOUT_TYPE"));
});

// HRA-392: HRA-390's embedded Schedule message decoded fine but was never
// placed on a real Forerunner 965's Training Calendar — the workout FIT must
// no longer carry it at all; scheduling now lives exclusively in the
// dedicated Schedules-type file below.
test("the exported workout FIT no longer carries an embedded Schedule message", () => {
  const day = resolve("D1: 10km @ RG");
  const outcome = toGarminWorkoutFit(day);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("unreachable");

  const { messages, errors } = decodeGarminWorkoutFit(outcome.bytes);
  assert.deepEqual(errors, []);
  assert.equal(messages.scheduleMesgs, undefined);
});

// HRA-392: a Forerunner 965 only recognizes a Training Calendar entry from a
// dedicated File Id type "schedules" file (profile.js file-type enum 7,
// "Read/write, single file. Directory=Schedules") — never from a message
// riding inside the workout-type file.
test("toGarminSchedulesFit produces a File Id type 'schedules' file with one Schedule entry per date", () => {
  const bytes = toGarminSchedulesFit(["2026-01-05", "2026-01-12"]);
  const { messages, errors } = decodeGarminWorkoutFit(bytes);
  assert.deepEqual(errors, []);

  const [fileId] = messages.fileIdMesgs as Array<{ type: string; manufacturer: string; product: number }>;
  assert.equal(fileId.type, "schedules");

  const scheduleMesgs = messages.scheduleMesgs as Array<{
    manufacturer: string; product: number; timeCreated: Date; type: string; completed: number; scheduledTime: number;
  }>;
  assert.equal(scheduleMesgs.length, 2);
  for (const [i, date] of ["2026-01-05", "2026-01-12"].entries()) {
    const schedule = scheduleMesgs[i];
    assert.equal(schedule.type, "workout");
    assert.equal(schedule.completed, 0);
    // Identity fields (manufacturer/product/timeCreated) must match the
    // paired toGarminWorkoutFit() File Id for the same date so a device can
    // resolve which workout file this entry schedules (profile.js's field
    // comments: "Corresponds to file_id of scheduled workout / course").
    assert.equal(schedule.manufacturer, fileId.manufacturer);
    assert.equal(schedule.product, fileId.product);
    const workoutOutcome = toGarminWorkoutFit(resolveAt("D1: 10km @ RG", date));
    if (!workoutOutcome.ok) throw new Error("unreachable");
    const [workoutFileId] = decodeGarminWorkoutFit(workoutOutcome.bytes).messages.fileIdMesgs as Array<{ timeCreated: Date }>;
    // @garmin/fitsdk decodes "dateTime" fields to Date objects, so compare
    // by value (getTime()), not object identity.
    assert.equal(schedule.timeCreated.getTime(), workoutFileId.timeCreated.getTime());

    const scheduledDate = scheduledTimeToDate(schedule.scheduledTime);
    assert.equal(scheduledDate.toISOString().slice(0, 10), date);
  }
});

// scheduledTime is built from the plan day's own calendar-date string at
// literal UTC midnight (mirroring FILE_ID.timeCreated), so it must resolve
// to the exact same calendar date regardless of a DST transition on that
// date — 2026-03-29 is the same Europe/Rome spring-forward boundary used in
// test/domain/plan-timezone.test.ts.
test("toGarminSchedulesFit scheduledTime equals the plan date across a DST-boundary date", () => {
  const bytes = toGarminSchedulesFit(["2026-03-29"]);
  const { messages } = decodeGarminWorkoutFit(bytes);
  const [schedule] = messages.scheduleMesgs as Array<{ scheduledTime: number }>;
  const scheduledDate = scheduledTimeToDate(schedule.scheduledTime);
  assert.equal(scheduledDate.toISOString().slice(0, 10), "2026-03-29");
});

test("toGarminSchedulesFit rejects an empty date list", () => {
  assert.throws(() => toGarminSchedulesFit([]));
});

test("toGarminSchedulesFit is deterministic for the same dates", () => {
  const first = toGarminSchedulesFit(["2026-01-05", "2026-01-12"]);
  const second = toGarminSchedulesFit(["2026-01-05", "2026-01-12"]);
  assert.equal(Buffer.compare(first, second), 0);
});

test("encoding the same day twice produces byte-identical FIT output (deterministic)", () => {
  const day = resolve("D1: 4x3000m @ RG-20 r:1km @ RG+10");
  const first = toGarminWorkoutFit(day);
  const second = toGarminWorkoutFit(day);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) throw new Error("unreachable");
  assert.equal(Buffer.compare(first.bytes, second.bytes), 0);
});
