import { describe, it, expect } from "vitest";
import {
  formatAbsoluteIntensity, formatDistanceTarget, formatDurationTarget, formatOffsetIntensity,
  parseIntensityToken, parseTargetToken, reparseIntensityOk, reparseTargetOk, serializeIntensity, serializeSegment,
} from "./runplan-serializer";
import type { IntervalSegment, OffsetIntensity } from "@/types/runplan";

describe("format*", () => {
  it("formatDistanceTarget: whole km stays km, otherwise meters", () => {
    expect(formatDistanceTarget(5000)).toBe("5km");
    expect(formatDistanceTarget(1234)).toBe("1234m");
  });
  it("formatDurationTarget: largest whole unit", () => {
    expect(formatDurationTarget(3600)).toBe("1h");
    expect(formatDurationTarget(1800)).toBe("30min");
    expect(formatDurationTarget(90)).toBe("90s");
  });
  it("formatAbsoluteIntensity: seconds-per-km -> M:SS/km", () => {
    expect(formatAbsoluteIntensity(285)).toBe("4:45/km");
  });
  it("formatOffsetIntensity: preserves anchor", () => {
    expect(formatOffsetIntensity("RG", 30, "s/km")).toBe("RG+30");
    expect(formatOffsetIntensity("RG", -20, "s/km")).toBe("RG-20");
  });
});

describe("parseTargetToken / parseIntensityToken", () => {
  it("parses a distance token", () => {
    expect(parseTargetToken("5km")).toEqual({ kind: "distance", distance_m: 5000, raw: "5km" });
  });
  it("parses a duration token", () => {
    expect(parseTargetToken("30min")).toEqual({ kind: "duration", duration_sec: 1800, raw: "30min" });
  });
  it("falls back to unknown for garbage", () => {
    expect(parseTargetToken("nope").kind).toBe("unknown");
  });
  it("parses an offset intensity, default unit from context", () => {
    expect(parseIntensityToken("RG+30", "s/km")).toEqual({ kind: "offset", anchor: "RG", offset_sec_per_km: 30, raw: "RG+30" });
  });
  it("parses an anchor intensity", () => {
    expect(parseIntensityToken("RG", "s/km")).toEqual({ kind: "anchor", anchor: "RG", raw: "RG" });
  });
  it("parses an absolute pace", () => {
    expect(parseIntensityToken("4:45/km", "s/km")).toEqual({ kind: "absolute", pace_sec_per_km: 285, raw: "4:45/km" });
  });
});

describe("serializeTarget / serializeIntensity round-trip", () => {
  it("distance target round-trips", () => {
    const target = parseTargetToken("5km");
    expect(reparseTargetOk(target)).toBe(true);
  });
  it("unknown target never round-trips (AC6)", () => {
    expect(reparseTargetOk(parseTargetToken("garbage"))).toBe(false);
  });
  it("AC3: editing only the offset preserves the anchor", () => {
    const original = parseIntensityToken("RG+30", "s/km") as OffsetIntensity;
    const edited: OffsetIntensity = { ...original, offset_sec_per_km: 45 };
    const raw = serializeIntensity(edited, "s/km");
    expect(raw).toBe("RG+45");
    const reparsed = parseIntensityToken(raw, "s/km");
    expect(reparsed).toEqual({ kind: "offset", anchor: "RG", offset_sec_per_km: 45, raw: "RG+45" });
    expect(reparseIntensityOk(edited, "s/km")).toBe(true);
  });
});

describe("serializeSegment", () => {
  it("continuous", () => {
    const seg = { type: "continuous" as const, target: parseTargetToken("10km"), intensity: parseIntensityToken("FL", "s/km"), raw: "" };
    expect(serializeSegment(seg, "s/km")).toBe("10km @ FL");
  });
  it("interval with rest", () => {
    const seg: IntervalSegment = {
      type: "interval", reps: 4, work_target: parseTargetToken("1000m"), work_intensity: parseIntensityToken("RG-20", "s/km"),
      rest: { target: parseTargetToken("400m"), intensity: parseIntensityToken("jog", "s/km"), rest_type: "jog", raw: "" },
      raw: "",
    };
    expect(serializeSegment(seg, "s/km")).toBe("4x1km @ RG-20 r:400m @ jog jog");
  });
});
