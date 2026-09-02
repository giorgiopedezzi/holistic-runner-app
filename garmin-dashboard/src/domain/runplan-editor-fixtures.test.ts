// ── RunPlan DSL v1 — structured editor round-trip fixture suite (HRA-237) ──
// Regression + round-trip coverage across the grammar matrix Epic HRA-228
// enumerated, exercised through the ACTUAL structured-field edit functions
// (domain/runplan-serializer.ts's apply*Edit) the UI calls — parse (via the
// token parsers) -> structured -> edit -> serialize -> reparse, asserting
// the reparsed model is semantically equivalent to the intended edit
// (docs/runplan-dsl.md's "textual identity is not required" contract).
// Complements runplan-serializer.test.ts (which covers the individual
// functions) and garmin-stats/test/domain/runplan/editor-roundtrip.test.ts
// (the backend twin, using the real parser).
import { describe, it, expect } from "vitest";
import {
  applyDistanceOrDurationEdit, applyPaceEdit, applyRecoveryPaceEdit, applyRecoveryTargetEdit, applyRepetitionsEdit,
  parseIntensityToken, parseTargetToken, reparseIntensityOk, reparseTargetOk, serializeSegment,
} from "./runplan-serializer";
import { replaceSegmentInDayLine } from "./runplan-patch";
import type { ContinuousSegment, IntervalSegment, OffsetUnit, WorkoutSegment } from "@/types/runplan";

function continuous(target: string, intensity: string, offsetUnit: OffsetUnit = "s/km"): ContinuousSegment {
  return { type: "continuous", target: parseTargetToken(target), intensity: parseIntensityToken(intensity, offsetUnit), raw: "" };
}
function interval(reps: number | null, target: string, intensity: string, rest?: { target: string; rest_type?: "stand" | "walk" | "jog" }, offsetUnit: OffsetUnit = "s/km"): IntervalSegment {
  return {
    type: "interval", reps, work_target: parseTargetToken(target), work_intensity: parseIntensityToken(intensity, offsetUnit),
    rest: rest ? { target: parseTargetToken(rest.target), rest_type: rest.rest_type, raw: "" } : undefined,
    raw: "",
  };
}

describe("editable construct round-trip: Distance/Duration field, mixed units", () => {
  it.each([
    ["5km", "10km @ RG"],
    ["800m", "10km @ RG"],
    ["3mi", "10km @ RG"],
    ["45min", "30min @ RG"],
    ["1h", "30min @ RG"],
    ["90s", "30min @ RG"],
  ])("editing to %s round-trips to an equivalent target", (newValue, seedSegment) => {
    const segment: WorkoutSegment = { ...(continuous("10km", "RG")), raw: seedSegment };
    const updated = applyDistanceOrDurationEdit(segment, newValue);
    expect(updated).not.toBeNull();
    const reparsed = parseTargetToken(serializeSegment(updated!, "s/km").split(" @ ")[0]);
    expect(reparseTargetOk((updated as ContinuousSegment).target)).toBe(true);
    expect(reparsed.kind).toBe(parseTargetToken(newValue).kind);
  });
});

describe("editable construct round-trip: Pace field, absolute pace + anchor modifiers", () => {
  it("editing to an absolute pace (km) round-trips", () => {
    const segment = continuous("10km", "RG");
    const updated = applyPaceEdit(segment, "4:15/km", "s/km");
    expect(updated).not.toBeNull();
    expect(reparseIntensityOk((updated as ContinuousSegment).intensity, "s/km")).toBe(true);
  });
  it("editing to an absolute pace (mi) round-trips", () => {
    const segment = continuous("10km", "RG");
    const updated = applyPaceEdit(segment, "6:30/mi", "s/km");
    expect(updated).not.toBeNull();
    expect(reparseIntensityOk((updated as ContinuousSegment).intensity, "s/km")).toBe(true);
  });
  it("editing only the offset preserves the anchor name (AC3, s/km)", () => {
    const segment = continuous("10km", "RG+20");
    const updated = applyPaceEdit(segment, "RG+45", "s/km") as ContinuousSegment;
    expect(updated.intensity).toEqual({ kind: "offset", anchor: "RG", offset_sec_per_km: 45, raw: "RG+45" });
  });
  it("editing the offset with an explicit s/mi unit override round-trips under s/km context", () => {
    const segment = continuous("10km", "RG");
    const updated = applyPaceEdit(segment, "RG-10s/mi", "s/km") as ContinuousSegment;
    expect(updated.intensity.kind).toBe("offset");
    expect(reparseIntensityOk(updated.intensity, "s/km")).toBe(true);
  });
  it("editing back to a bare anchor round-trips", () => {
    const segment = continuous("10km", "RG+20");
    const updated = applyPaceEdit(segment, "FL", "s/km") as ContinuousSegment;
    expect(updated.intensity).toEqual({ kind: "anchor", anchor: "FL", raw: "FL" });
  });
});

describe("editable construct round-trip: Repetitions field", () => {
  it("edits to a whole number", () => {
    const segment = interval(4, "1000m", "RG-20");
    const updated = applyRepetitionsEdit(segment, "8") as IntervalSegment;
    expect(updated.reps).toBe(8);
  });
  it("edits to '?' (unspecified)", () => {
    const segment = interval(4, "1000m", "RG-20");
    const updated = applyRepetitionsEdit(segment, "?") as IntervalSegment;
    expect(updated.reps).toBeNull();
  });
});

describe("editable construct round-trip: Recovery field — distance, duration, standing", () => {
  it("recovery target: distance -> distance (mixed unit) round-trips", () => {
    const segment = interval(4, "1000m", "RG-20", { target: "400m", rest_type: "jog" });
    const updated = applyRecoveryTargetEdit(segment, "0.5mi") as IntervalSegment;
    expect(reparseTargetOk(updated.rest!.target)).toBe(true);
    expect(updated.rest!.target.kind).toBe("distance");
  });
  it("recovery target: distance -> duration round-trips", () => {
    const segment = interval(4, "1000m", "RG-20", { target: "400m", rest_type: "jog" });
    const updated = applyRecoveryTargetEdit(segment, "90s") as IntervalSegment;
    expect(updated.rest!.target).toEqual({ kind: "duration", duration_sec: 90, raw: "90s" });
  });
  it("recovery pace edits and round-trips (used for standing recovery's own pace field)", () => {
    const segment = interval(4, "1000m", "RG-20", { target: "400m", rest_type: "stand" });
    const updated = applyRecoveryPaceEdit(segment, "RG+60", "s/km") as IntervalSegment;
    expect(reparseIntensityOk(updated.rest!.intensity!, "s/km")).toBe(true);
    expect(updated.rest!.rest_type).toBe("stand"); // untouched by a pace-only edit
  });
  it("no recovery clause on the segment: recovery edits are rejected, not fabricated", () => {
    const segment = interval(4, "1000m", "RG-20"); // no rest
    expect(applyRecoveryTargetEdit(segment, "400m")).toBeNull();
    expect(applyRecoveryPaceEdit(segment, "RG+10", "s/km")).toBeNull();
  });
});

describe("multi-segment day: editing one segment's DSL leaves the others' text untouched (AC4)", () => {
  it("replaceSegmentInDayLine only rewrites the targeted segment", () => {
    const line = "D3: 10km @ RG+20 ; 30min @ RG ; 5km @ FL-10";
    const newDsl = replaceSegmentInDayLine(line, 1, serializeSegment(continuous("45min", "RG"), "s/km"));
    expect(newDsl).toBe("D3: 10km @ RG+20 ; 45min @ RG ; 5km @ FL-10");
    // The untouched 1st/3rd segments are byte-identical to the original line.
    expect(newDsl.split(";")[0].trim()).toBe(line.split(";")[0].trim());
    expect(newDsl.split(";")[2].trim()).toBe(line.split(";")[2].trim());
  });
});

describe("invalid DSL: an edit that doesn't round-trip is rejected (AC6), never silently applied", () => {
  it("garbage Distance/Duration input is rejected", () => {
    const segment = continuous("10km", "RG");
    expect(applyDistanceOrDurationEdit(segment, "not-a-target")).toBeNull();
  });
  it("garbage Pace input is rejected", () => {
    const segment = continuous("10km", "RG");
    expect(applyPaceEdit(segment, "not-a-pace!", "s/km")).toBeNull();
  });
  it("empty/non-integer Repetitions input is rejected", () => {
    const segment = interval(4, "1000m", "RG-20");
    expect(applyRepetitionsEdit(segment, "")).toBeNull();
    expect(applyRepetitionsEdit(segment, "1.5")).toBeNull();
    expect(applyRepetitionsEdit(segment, "0")).toBeNull();
  });
});
