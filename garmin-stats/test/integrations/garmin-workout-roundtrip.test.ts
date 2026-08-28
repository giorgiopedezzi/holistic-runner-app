/**
 * test/integrations/garmin-workout-roundtrip.test.ts (HRA-185)
 * Export (HRA-184) -> real FIT bytes -> import (HRA-185) round trip, for
 * every shape the exporter supports. Per the Story's acceptance criteria:
 * repetition counts, targets, recovery presence, ordering, and totals must
 * be equivalent; resolved pace may differ by no more than 0.2 sec/km after
 * FIT quantization.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayEntry } from "../../src/domain/runplan/parser.ts";
import { resolveDay } from "../../src/domain/runplan/instantiate.ts";
import type { ResolvedDay, ResolvedSegment } from "../../src/domain/runplan/instantiate.ts";
import type { DayParseContext, PacePolicy } from "../../src/domain/runplan/types.ts";
import { Encoder, Profile } from "@garmin/fitsdk";
import { fromGarminWorkoutFit, toGarminWorkoutFit } from "../../src/integrations/garmin-workout.ts";

const POLICY: PacePolicy = {
  RG: { kind: "absolute", pace_sec_per_km: 256 },
  FL: { kind: "absolute", pace_sec_per_km: 300 },
};

const CTX: DayParseContext = {
  unit: "km", offset_unit: "s/km", default_rest: "jog", pacePolicy: POLICY,
  allowUnboundPace: false,
};

const PACE_TOLERANCE_SEC_PER_KM = 0.2;

function resolve(raw: string): ResolvedDay {
  const day = parseDayEntry(raw, CTX);
  return resolveDay(day, "Base", 1, "2026-01-05", POLICY);
}

function assertPaceClose(actual: number | null | undefined, expected: number, label: string): void {
  assert.ok(actual != null, `${label}: expected a resolved pace, got ${actual}`);
  assert.ok(Math.abs((actual as number) - expected) <= PACE_TOLERANCE_SEC_PER_KM, `${label}: ${actual} not within ${PACE_TOLERANCE_SEC_PER_KM} sec/km of ${expected}`);
}

function roundTrip(day: ResolvedDay): ResolvedSegment[] {
  const exported = toGarminWorkoutFit(day);
  assert.equal(exported.ok, true);
  if (!exported.ok) throw new Error("unreachable");
  const imported = fromGarminWorkoutFit(exported.bytes);
  assert.equal(imported.ok, true);
  if (!imported.ok) throw new Error("unreachable");
  assert.equal(imported.preview.canApply, true, JSON.stringify(imported.preview.warnings));
  return imported.preview.segments;
}

test("continuous distance round-trips: target and pace preserved within tolerance", () => {
  const segments = roundTrip(resolve("D1: 10km @ RG"));
  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.equal(segment.type, "continuous");
  if (segment.type !== "continuous") throw new Error("unreachable");
  assert.equal(segment.target.kind, "distance");
  if (segment.target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.target.distance_m, 10000);
  assertPaceClose(segment.resolved_pace_sec_per_km, 256, "continuous distance");
});

test("continuous duration round-trips: target and pace preserved within tolerance", () => {
  const segments = roundTrip(resolve("D1: 40min @ RG"));
  const [segment] = segments;
  assert.equal(segment.type, "continuous");
  if (segment.type !== "continuous") throw new Error("unreachable");
  assert.equal(segment.target.kind, "duration");
  if (segment.target.kind !== "duration") throw new Error("unreachable");
  assert.equal(segment.target.duration_sec, 2400);
  assertPaceClose(segment.resolved_pace_sec_per_km, 256, "continuous duration");
});

test("interval with recovery round-trips: reps, work target, recovery presence, and both paces preserved", () => {
  const segments = roundTrip(resolve("D1: 4x3000m @ RG-20 r:1km @ RG+10"));
  assert.equal(segments.length, 1);
  const [segment] = segments;
  assert.equal(segment.type, "interval");
  if (segment.type !== "interval") throw new Error("unreachable");
  assert.equal(segment.reps, 4);
  assert.equal(segment.work_target.kind, "distance");
  if (segment.work_target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.work_target.distance_m, 3000);
  assertPaceClose(segment.work_resolved_pace_sec_per_km, 236, "interval work");
  assert.ok(segment.rest != null);
  assert.equal(segment.rest?.target.kind, "distance");
  if (segment.rest?.target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.rest.target.distance_m, 1000);
  assertPaceClose(segment.rest.resolved_pace_sec_per_km, 266, "interval recovery");
});

test("interval without recovery round-trips: reps and work target preserved, no rest key", () => {
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
  const segments = roundTrip(day);
  const [segment] = segments;
  assert.equal(segment.type, "interval");
  if (segment.type !== "interval") throw new Error("unreachable");
  assert.equal(segment.reps, 6);
  assert.equal(segment.rest, undefined);
  assertPaceClose(segment.work_resolved_pace_sec_per_km, 220, "interval work (no recovery)");
});

test("an explicit progression round-trips to the original start/end pace semantics, plus the recorded lossy-conversion warning", () => {
  const exported = toGarminWorkoutFit(resolve("D1: 10km PROG FL->RG"));
  assert.equal(exported.ok, true);
  if (!exported.ok) throw new Error("unreachable");
  const imported = fromGarminWorkoutFit(exported.bytes);
  assert.equal(imported.ok, true);
  if (!imported.ok) throw new Error("unreachable");
  assert.equal(imported.preview.canApply, true);

  const [segment] = imported.preview.segments;
  assert.equal(segment.type, "progression");
  if (segment.type !== "progression") throw new Error("unreachable");
  assert.equal(segment.target.kind, "distance");
  if (segment.target.kind !== "distance") throw new Error("unreachable");
  assert.equal(segment.target.distance_m, 10000);
  assertPaceClose(segment.start_resolved_pace_sec_per_km, 300, "progression start"); // FL
  assertPaceClose(segment.end_resolved_pace_sec_per_km, 256, "progression end"); // RG

  assert.ok(imported.preview.warnings.some(w => w.code === "IMPORTED_PROGRESSION_FROM_STAIRCASE"));
});

test("already-staged continuous workouts (unmarked) round-trip as N separate ordered continuous segments, not a guessed progression", () => {
  const segments = roundTrip(resolve("D1: 2km @ RG-30 ; 2km @ RG-15 ; 2km @ RG"));
  assert.equal(segments.length, 3);
  assert.ok(segments.every(s => s.type === "continuous"));
});

test("a rest day round-trips to a single rest_block segment", () => {
  const segments = roundTrip(resolve("D1: REST"));
  assert.equal(segments.length, 1);
  assert.equal(segments[0].type, "rest_block");
});

// ── malformed / structurally-invalid FIT input ──────────────────────────

test("malformed FIT bytes return a structured decode error, no partial resolved model", () => {
  const outcome = fromGarminWorkoutFit(Buffer.from([0x00, 0x01, 0x02, 0x03]));
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.error.code, "DECODE_ERROR");
});

test("a structurally valid FIT file whose File Id type is not \"workout\" is rejected", () => {
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: Profile.MesgNum.FILE_ID, type: "activity", manufacturer: "development", product: 1, timeCreated: new Date("2026-01-05T00:00:00Z") });
  const bytes = Buffer.from(encoder.close());

  const outcome = fromGarminWorkoutFit(bytes);
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.error.code, "NOT_A_WORKOUT_FILE");
});

test("a Workout FIT file with no Workout Step messages is rejected", () => {
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: Profile.MesgNum.FILE_ID, type: "workout", manufacturer: "development", product: 1, timeCreated: new Date("2026-01-05T00:00:00Z") });
  encoder.writeMesg({ mesgNum: Profile.MesgNum.WORKOUT, wktName: "Empty", sport: "running", numValidSteps: 0 });
  const bytes = Buffer.from(encoder.close());

  const outcome = fromGarminWorkoutFit(bytes);
  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("unreachable");
  assert.equal(outcome.error.code, "MISSING_WORKOUT_STEPS");
});
