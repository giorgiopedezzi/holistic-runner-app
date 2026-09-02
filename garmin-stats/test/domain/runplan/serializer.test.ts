/**
 * test/domain/runplan/serializer.test.ts (HRA-234)
 * Unit + round-trip tests for the new AST -> DSL segment serializer —
 * serialize a segment, reparse it (parseDayEntry via a minimal one-day
 * document), and assert the reparsed model is semantically equivalent to the
 * segment that was serialized (docs/runplan-dsl.md's "textual identity not
 * required" contract).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayEntry } from "../../../src/domain/runplan/parser.ts";
import {
  formatAbsoluteIntensity, formatDistanceTarget, formatDurationTarget, formatOffsetIntensity,
  serializeDayBody, serializeIntensity, serializeSegment, serializeTarget,
} from "../../../src/domain/runplan/serializer.ts";
import type {
  ContinuousSegment, DayParseContext, IntervalSegment, OffsetIntensity, ProgressionSegment, RestBlockSegment, WorkoutSegment,
} from "../../../src/domain/runplan/types.ts";

const ctx: DayParseContext = { unit: "km", offset_unit: "s/km", default_rest: "jog", pacePolicy: {}, allowUnboundPace: true };

function reparseSegment(raw: string): WorkoutSegment {
  const day = parseDayEntry(`D1: ${raw}`, ctx);
  assert.equal(day.segments.length, 1);
  return day.segments[0];
}

test("formatDistanceTarget: whole km stays km, otherwise meters", () => {
  assert.equal(formatDistanceTarget(5000), "5km");
  assert.equal(formatDistanceTarget(1234), "1234m");
});

test("formatDurationTarget: largest whole unit", () => {
  assert.equal(formatDurationTarget(3600), "1h");
  assert.equal(formatDurationTarget(1800), "30min");
  assert.equal(formatDurationTarget(90), "90s");
});

test("formatAbsoluteIntensity: seconds-per-km -> M:SS/km", () => {
  assert.equal(formatAbsoluteIntensity(285), "4:45/km");
  assert.equal(formatAbsoluteIntensity(240), "4:00/km");
});

test("formatOffsetIntensity: preserves anchor, s/km unit", () => {
  assert.equal(formatOffsetIntensity("RG", 30, "s/km"), "RG+30");
  assert.equal(formatOffsetIntensity("RG", -20, "s/km"), "RG-20");
});

test("formatOffsetIntensity: converts to s/mi when that's the effective unit", () => {
  const token = formatOffsetIntensity("RG", 30, "s/mi");
  assert.match(token, /^RG\+48\.28$/); // 30 * 1.60934, rounded to 2dp
});

test("serializeTarget/serializeIntensity round-trip through parseDayEntry (continuous)", () => {
  const seg = reparseSegment("5km @ RG+30") as ContinuousSegment;
  assert.equal(seg.type, "continuous");
  const raw = `${serializeTarget(seg.target)} @ ${serializeIntensity(seg.intensity, "s/km")}`;
  const reparsed = reparseSegment(raw) as ContinuousSegment;
  assert.deepEqual(reparsed.target, seg.target);
  assert.deepEqual(reparsed.intensity, seg.intensity);
});

test("AC3: editing only the offset value preserves the anchor name (not collapsed to absolute)", () => {
  const original = reparseSegment("5km @ RG+30") as ContinuousSegment;
  const originalIntensity = original.intensity as OffsetIntensity;
  const edited: OffsetIntensity = { ...originalIntensity, offset_sec_per_km: 45 };
  const raw = `${serializeTarget(original.target)} @ ${serializeIntensity(edited, "s/km")}`;
  const reparsed = reparseSegment(raw) as ContinuousSegment;
  assert.equal(reparsed.intensity.kind, "offset");
  assert.equal((reparsed.intensity as OffsetIntensity).anchor, "RG");
  assert.equal((reparsed.intensity as OffsetIntensity).offset_sec_per_km, 45);
});

test("serializeSegment: continuous", () => {
  const seg = reparseSegment("10km @ FL") as ContinuousSegment;
  const raw = serializeSegment(seg, "s/km");
  const reparsed = reparseSegment(raw) as ContinuousSegment;
  assert.deepEqual(reparsed.target, seg.target);
  assert.deepEqual(reparsed.intensity, seg.intensity);
});

test("serializeSegment: interval with rest", () => {
  const seg = reparseSegment("4x1000m @ RG-20 r:400m @ RG+60 jog") as IntervalSegment;
  const raw = serializeSegment(seg, "s/km");
  const reparsed = reparseSegment(raw) as IntervalSegment;
  assert.equal(reparsed.reps, 4);
  // Semantic equivalence, not textual identity (docs/runplan-dsl.md) —
  // 1000m/400m canonicalize to 1km/400m's own whole-km-or-meters rule, so
  // only distance_m (not raw) is compared.
  assert.equal((reparsed.work_target as { distance_m: number }).distance_m, (seg.work_target as { distance_m: number }).distance_m);
  assert.deepEqual(reparsed.work_intensity, seg.work_intensity);
  assert.equal(reparsed.rest!.target.kind, seg.rest!.target.kind);
  assert.equal((reparsed.rest!.target as { distance_m: number }).distance_m, (seg.rest!.target as { distance_m: number }).distance_m);
  assert.deepEqual(reparsed.rest!.intensity, seg.rest!.intensity);
  assert.equal(reparsed.rest!.rest_type, seg.rest!.rest_type);
});

test("serializeSegment: interval without rest, and with reps unspecified", () => {
  const noRest = reparseSegment("4x1000m @ RG-20") as IntervalSegment;
  assert.equal(reparseSegment(serializeSegment(noRest, "s/km")).type, "interval");
  const unspecified = reparseSegment("?x1000m @ RG-20") as IntervalSegment;
  const reparsed = reparseSegment(serializeSegment(unspecified, "s/km")) as IntervalSegment;
  assert.equal(reparsed.reps, null);
});

test("serializeSegment: progression", () => {
  const seg = reparseSegment("5km PROG RG -> FL") as ProgressionSegment;
  const raw = serializeSegment(seg, "s/km");
  const reparsed = reparseSegment(raw) as ProgressionSegment;
  assert.deepEqual(reparsed.target, seg.target);
  assert.deepEqual(reparsed.start_intensity, seg.start_intensity);
  assert.deepEqual(reparsed.end_intensity, seg.end_intensity);
});

test("serializeSegment: rest_block", () => {
  const seg = reparseSegment("REST 2km walk") as RestBlockSegment;
  const raw = serializeSegment(seg, "s/km");
  const reparsed = reparseSegment(raw) as RestBlockSegment;
  assert.deepEqual(reparsed.target, seg.target);
  assert.equal(reparsed.rest_type, seg.rest_type);
});

test("serializeSegment: unknown target/intensity pass through raw unchanged", () => {
  const seg = reparseSegment("? @ ?") as ContinuousSegment;
  const raw = serializeSegment(seg, "s/km");
  assert.equal(raw, "? @ ?");
});

test("serializeDayBody: multi-segment day joined with ' ; ', each segment independently round-trips", () => {
  const day = parseDayEntry("D1: 10km @ RG+20 ; 5km @ RG-5", ctx);
  const raw = serializeDayBody(day.segments, "s/km");
  const reparsed = parseDayEntry(`D1: ${raw}`, ctx);
  assert.equal(reparsed.segments.length, 2);
  assert.deepEqual(reparsed.segments, day.segments);
});
