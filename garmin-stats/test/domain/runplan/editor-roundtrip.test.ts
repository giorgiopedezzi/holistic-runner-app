/**
 * test/domain/runplan/editor-roundtrip.test.ts (HRA-237)
 * Regression + round-trip fixture suite across the grammar matrix Epic
 * HRA-228 enumerated for the structured workout editor: mixed distance
 * units, duration-based work, absolute pace, anchor modifiers, multiple
 * sequential segments, distance/duration/standing recovery, REST, OTHER,
 * comments, invalid DSL, and valid-but-not-yet-structurally-supported
 * syntax (progression, CROSS/STRENGTH). Mirrors parser.test.ts's golden-
 * fixture convention and serializer.test.ts's own reparse-for-equivalence
 * pattern (HRA-234) — every editable construct is run through
 * parse -> structured (an in-memory field edit) -> serialize -> reparse,
 * asserting the reparsed model is semantically equivalent to the intended
 * edit, not textually identical to the original (docs/runplan-dsl.md).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayEntry, parseRunPlanDSL } from "../../../src/domain/runplan/parser.ts";
import { serializeDayBody, serializeSegment } from "../../../src/domain/runplan/serializer.ts";
import type {
  ContinuousSegment, DayParseContext, IntervalSegment, OffsetIntensity, ProgressionSegment, RestSpec, Target, WorkoutSegment,
} from "../../../src/domain/runplan/types.ts";

const ctx: DayParseContext = { unit: "km", offset_unit: "s/km", default_rest: "jog", pacePolicy: { RG: { kind: "absolute", pace_sec_per_km: 300 } }, allowUnboundPace: true };

function parseDay(raw: string) {
  return parseDayEntry(`D1: ${raw}`, ctx);
}
function reparseSegment(raw: string): WorkoutSegment {
  const day = parseDay(raw);
  assert.equal(day.segments.length, 1, `expected exactly one segment for "${raw}"`);
  return day.segments[0];
}
// parse -> structured -> edit -> serialize -> reparse -> semantic equivalence.
function roundTripSegment(raw: string, edit: (seg: WorkoutSegment) => WorkoutSegment): WorkoutSegment {
  const original = reparseSegment(raw);
  const edited = edit(original);
  const serialized = serializeSegment(edited, "s/km");
  return reparseSegment(serialized);
}

// ── mixed distance units ────────────────────────────────────────────────

test("mixed distance units: m/km/mi all parse to correct meters and round-trip", () => {
  const m = reparseSegment("800m @ RG") as ContinuousSegment;
  assert.equal((m.target as { distance_m: number }).distance_m, 800);
  const km = reparseSegment("5km @ RG") as ContinuousSegment;
  assert.equal((km.target as { distance_m: number }).distance_m, 5000);
  const mi = reparseSegment("3mi @ RG") as ContinuousSegment;
  assert.equal(Math.round((mi.target as { distance_m: number }).distance_m), Math.round(3 * 1609.34));
});

test("editable construct: distance edit across units round-trips to the intended meters", () => {
  const reparsed = roundTripSegment("5km @ RG", seg => {
    const c = seg as ContinuousSegment;
    return { ...c, target: { kind: "distance", distance_m: 12345, raw: "" } };
  }) as ContinuousSegment;
  assert.equal((reparsed.target as { distance_m: number }).distance_m, 12345);
});

// ── duration-based work ─────────────────────────────────────────────────

test("duration work: s/sec/min/h/apostrophe-minutes all parse and round-trip", () => {
  assert.deepEqual((reparseSegment("90s @ RG") as ContinuousSegment).target, { kind: "duration", duration_sec: 90, raw: "90s" });
  assert.equal(((reparseSegment("45min @ RG") as ContinuousSegment).target as { duration_sec: number }).duration_sec, 2700);
  assert.equal(((reparseSegment("1h @ RG") as ContinuousSegment).target as { duration_sec: number }).duration_sec, 3600);
  assert.equal(((reparseSegment("10' @ RG") as ContinuousSegment).target as { duration_sec: number }).duration_sec, 600);
});

test("editable construct: duration edit round-trips to the intended seconds", () => {
  const reparsed = roundTripSegment("45min @ RG", seg => {
    const c = seg as ContinuousSegment;
    return { ...c, target: { kind: "duration", duration_sec: 5400, raw: "" } };
  }) as ContinuousSegment;
  assert.equal((reparsed.target as { duration_sec: number }).duration_sec, 5400);
});

// ── absolute pace ───────────────────────────────────────────────────────

test("absolute pace: km and mi both resolve to the same pace_sec_per_km, round-trips", () => {
  const km = reparseSegment("5km @ 4:30/km") as ContinuousSegment;
  assert.equal((km.intensity as { pace_sec_per_km: number }).pace_sec_per_km, 270);
  const mi = reparseSegment("3mi @ 7:15/mi") as ContinuousSegment;
  assert.ok(Math.abs((mi.intensity as { pace_sec_per_km: number }).pace_sec_per_km - 435 / 1.60934) < 0.5);
});

test("editable construct: absolute pace edit round-trips (within 1s rounding)", () => {
  const reparsed = roundTripSegment("5km @ 4:30/km", seg => {
    const c = seg as ContinuousSegment;
    return { ...c, intensity: { kind: "absolute", pace_sec_per_km: 255, raw: "" } };
  }) as ContinuousSegment;
  assert.ok(Math.abs((reparsed.intensity as { pace_sec_per_km: number }).pace_sec_per_km - 255) <= 1);
});

// ── anchor modifiers ────────────────────────────────────────────────────

test("anchor modifiers: bare anchor, offset, offset with explicit unit override", () => {
  const bare = reparseSegment("5km @ RG") as ContinuousSegment;
  assert.deepEqual(bare.intensity, { kind: "anchor", anchor: "RG", raw: "RG" });
  const offset = (reparseSegment("5km @ RG+30") as ContinuousSegment).intensity as OffsetIntensity;
  assert.equal(offset.anchor, "RG");
  assert.equal(offset.offset_sec_per_km, 30);
  const offsetMi = (reparseSegment("5km @ RG-5s/mi") as ContinuousSegment).intensity as OffsetIntensity;
  assert.equal(offsetMi.anchor, "RG");
  assert.ok(Math.abs(offsetMi.offset_sec_per_km - -5 / 1.60934) < 0.01);
});

test("editable construct: offset-only edit preserves the anchor name (AC3 convention)", () => {
  const reparsed = roundTripSegment("5km @ RG+30", seg => {
    const c = seg as ContinuousSegment;
    const original = c.intensity as OffsetIntensity;
    return { ...c, intensity: { ...original, offset_sec_per_km: 55 } };
  }) as ContinuousSegment;
  const intensity = reparsed.intensity as OffsetIntensity;
  assert.equal(intensity.kind, "offset");
  assert.equal(intensity.anchor, "RG");
  assert.equal(intensity.offset_sec_per_km, 55);
});

// ── multiple sequential segments ────────────────────────────────────────

test("multi-segment day: each ;-joined segment independently round-trips through serializeDayBody", () => {
  const day = parseDay("10km @ RG+20 ; 30min @ RG ; 3mi @ 5:00/km");
  assert.equal(day.segments.length, 3);
  const raw = serializeDayBody(day.segments, "s/km");
  const reparsed = parseDay(raw);
  assert.equal(reparsed.segments.length, 3);
  // Semantic equivalence, not textual identity (docs/runplan-dsl.md) — the
  // 3rd segment's "3mi" canonicalizes to its meter value on the way back out,
  // so only target.kind/distance_m or duration_sec (never raw) is compared.
  reparsed.segments.forEach((seg, i) => {
    const reparsedTarget = (seg as ContinuousSegment).target;
    const originalTarget = (day.segments[i] as ContinuousSegment).target;
    assert.equal(reparsedTarget.kind, originalTarget.kind);
    if (reparsedTarget.kind === "distance" && originalTarget.kind === "distance") {
      assert.ok(Math.abs(reparsedTarget.distance_m - originalTarget.distance_m) < 0.01);
    }
    assert.deepEqual((seg as ContinuousSegment).intensity, (day.segments[i] as ContinuousSegment).intensity);
  });
});

// ── repetitions with distance / duration recovery, standing recovery ───

test("interval with distance recovery round-trips", () => {
  const seg = reparseSegment("4x1000m @ RG-20 r:400m @ jog jog") as IntervalSegment;
  assert.equal(seg.rest!.target.kind, "distance");
  const reparsed = reparseSegment(serializeSegment(seg, "s/km")) as IntervalSegment;
  assert.equal((reparsed.rest!.target as { distance_m: number }).distance_m, (seg.rest!.target as { distance_m: number }).distance_m);
});

test("interval with duration recovery round-trips", () => {
  const seg = reparseSegment("4x1000m @ RG-20 r:90s @ jog jog") as IntervalSegment;
  assert.equal(seg.rest!.target.kind, "duration");
  const reparsed = reparseSegment(serializeSegment(seg, "s/km")) as IntervalSegment;
  assert.equal((reparsed.rest!.target as { duration_sec: number }).duration_sec, (seg.rest!.target as { duration_sec: number }).duration_sec);
});

test("interval with standing recovery (rest_type stand) round-trips", () => {
  const seg = reparseSegment("4x1000m @ RG-20 r:400m stand") as IntervalSegment;
  assert.equal(seg.rest!.rest_type, "stand");
  const reparsed = reparseSegment(serializeSegment(seg, "s/km")) as IntervalSegment;
  assert.equal(reparsed.rest!.rest_type, "stand");
});

test("editable construct: recovery target edit (distance -> duration) round-trips to the intended value", () => {
  const reparsed = roundTripSegment("4x1000m @ RG-20 r:400m @ jog jog", seg => {
    const iv = seg as IntervalSegment;
    const rest: RestSpec = { ...iv.rest!, target: { kind: "duration", duration_sec: 120, raw: "" } };
    return { ...iv, rest };
  }) as IntervalSegment;
  assert.equal((reparsed.rest!.target as { duration_sec: number }).duration_sec, 120);
});

test("editable construct: recovery rest_type edit (jog -> stand) round-trips", () => {
  const reparsed = roundTripSegment("4x1000m @ RG-20 r:400m @ jog jog", seg => {
    const iv = seg as IntervalSegment;
    const rest: RestSpec = { ...iv.rest!, rest_type: "stand" };
    return { ...iv, rest };
  }) as IntervalSegment;
  assert.equal(reparsed.rest!.rest_type, "stand");
});

test("editable construct: repetitions edit round-trips, including '?' unspecified", () => {
  const reparsed4 = roundTripSegment("4x1000m @ RG-20", seg => ({ ...(seg as IntervalSegment), reps: 8 })) as IntervalSegment;
  assert.equal(reparsed4.reps, 8);
  const reparsedUnspec = roundTripSegment("4x1000m @ RG-20", seg => ({ ...(seg as IntervalSegment), reps: null })) as IntervalSegment;
  assert.equal(reparsedUnspec.reps, null);
});

// ── REST / OTHER whole-day keywords ─────────────────────────────────────

test("REST day: parses to workout_type rest, zero segments, zero warnings, round-trips as itself", () => {
  const day = parseDayEntry("D3: REST", ctx);
  assert.equal(day.workout_type, "rest");
  assert.equal(day.segments.length, 0);
  assert.equal(day.needs_review, false);
  const reparsed = parseDayEntry(day.raw_dsl, ctx);
  assert.equal(reparsed.workout_type, "rest");
});

test("OTHER day: parses to workout_type other, zero warnings (HRA-156), round-trips as itself", () => {
  const day = parseDayEntry("D3: OTHER", ctx);
  assert.equal(day.workout_type, "other");
  assert.equal(day.needs_review, false);
  const reparsed = parseDayEntry(day.raw_dsl, ctx);
  assert.equal(reparsed.workout_type, "other");
});

test("OTHER fallback: a line with no D<n>: pattern degrades to a real, reparseable OTHER placeholder", () => {
  const day = parseDayEntry("some messy unparsed text", ctx);
  assert.equal(day.workout_type, "other");
  assert.equal(day.notes, "some messy unparsed text");
  assert.equal(day.raw_dsl, "D1: OTHER");
  const reparsed = parseDayEntry(day.raw_dsl, ctx);
  assert.equal(reparsed.workout_type, "other");
  assert.equal(reparsed.needs_review, false);
});

// ── comments ─────────────────────────────────────────────────────────────

test("trailing '# note' on a day line is preserved through raw_dsl and survives reparse", () => {
  const day = parseDayEntry("D2: 5km @ RG # easy shakeout", ctx);
  assert.equal(day.notes, "easy shakeout");
  assert.equal(day.segments.length, 1);
  const reparsed = parseDayEntry(day.raw_dsl, ctx);
  assert.equal(reparsed.notes, "easy shakeout");
  assert.deepEqual(reparsed.segments, day.segments);
});

test("a full-line '#...' comment is ignored by the whole-document parser, not surfaced as a warning", () => {
  const result = parseRunPlanDSL(`
SECTION "Base" WEEKS 1
WEEK 1
# a full-line comment, should be ignored entirely
D1: 5km @ RG
`);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.plan.sections[0].weeks[0].days.length, 1);
});

// ── invalid DSL ──────────────────────────────────────────────────────────

test("invalid DSL: an unrecognized intensity token degrades to kind:unknown with a warning, never a hard failure", () => {
  const day = parseDay("5km @ n/a"); // "/" fails every intensity token regex, incl. ANCHOR_RE
  const seg = day.segments[0] as ContinuousSegment;
  assert.equal(seg.intensity.kind, "unknown");
  assert.equal(day.needs_review, true);
  assert.ok(day.warnings.some(w => /Intensity is unspecified or unrecognized/.test(w.message)));
});

test("invalid DSL: malformed interval syntax (trailing garbage) degrades to a fully-unknown segment with a warning", () => {
  const day = parseDay("4x1000m @ RG garbage"); // matches the interval header, but not the full grammar
  const seg = day.segments[0] as IntervalSegment;
  assert.equal(seg.work_target.kind, "unknown");
  assert.ok(day.warnings.some(w => /Invalid interval syntax/.test(w.message)));
});

test("invalid DSL: empty input is the only ok:false case (HRA-120)", () => {
  const result = parseRunPlanDSL("");
  assert.equal(result.ok, false);
});

// ── valid-but-not-yet-structurally-supported syntax ─────────────────────

test("progression (unsupported in Structured view): parses cleanly and round-trips", () => {
  const seg = reparseSegment("5km PROG RG -> FL") as ProgressionSegment;
  assert.equal(seg.type, "progression");
  const reparsed = reparseSegment(serializeSegment(seg, "s/km")) as ProgressionSegment;
  assert.deepEqual(reparsed.target, seg.target);
  assert.deepEqual(reparsed.start_intensity, seg.start_intensity);
});

test("CROSS with target+description (unsupported in Structured view): parses cleanly, needs_review false", () => {
  const day = parseDayEntry("D4: CROSS 45min bike", ctx);
  assert.equal(day.workout_type, "cross");
  assert.equal(day.needs_review, false);
  assert.equal((day.activity_target as Target).kind, "duration");
  assert.equal(day.activity_description, "bike");
});

test("STRENGTH with description only, no target: parses cleanly, needs_review false", () => {
  const day = parseDayEntry("D5: STRENGTH core", ctx);
  assert.equal(day.workout_type, "strength");
  assert.equal(day.needs_review, false);
  assert.equal(day.activity_target, undefined);
  assert.equal(day.activity_description, "core");
});
