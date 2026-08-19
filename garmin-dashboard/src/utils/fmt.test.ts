/**
 * src/utils/fmt.test.ts  (HRA-63)
 * Unit-aware formatters. These self-convert from their fixed internal unit, so
 * the tests double as the guard against the "double-conversion" trap documented
 * in CLAUDE.md (a caller must pass the raw internal-unit value, never a
 * pre-converted one).
 */
import { describe, it, expect, afterEach } from "vitest";
import { setUnitSystem } from "./units";
import { fmtPace, fmtDuration, fmtKm, fmtWeight, fmtElevation, fmtSpeed, fmtMinSecRaw, fmtDate } from "./fmt";

afterEach(() => setUnitSystem("metric"));

describe("fmtDuration (unit-independent)", () => {
  it("formats m:ss and h:mm:ss, rolling seconds over correctly", () => {
    expect(fmtDuration(2159.588)).toBe("36:00"); // rounds up; parts derived after rounding, no 59.6→60 carry bug
    expect(fmtDuration(3035.402)).toBe("50:35");
    expect(fmtDuration(3661)).toBe("1:01:01");
    expect(fmtDuration(null)).toBe("—");
  });
});

describe("fmtKm", () => {
  it("metric: km with 2dp, or metres under 1km", () => {
    setUnitSystem("metric");
    expect(fmtKm(6205.29)).toBe("6.21 km");
    expect(fmtKm(850)).toBe("850 m");
  });
  it("imperial: miles, or feet under 0.1mi (reference distance = 3.86 mi)", () => {
    setUnitSystem("imperial");
    expect(fmtKm(6205.29)).toBe("3.86 mi");
    expect(fmtKm(120)).toBe(`${Math.round(120 / 0.3048)} ft`);
  });
});

describe("fmtPace", () => {
  it("metric min/km", () => {
    setUnitSystem("metric");
    expect(fmtPace(5)).toBe("5:00");
    expect(fmtPace(5.801137)).toBe("5:48"); // reference activity avg pace
  });
  it("imperial min/mi (reference converts to 9:20, NOT the 9:34 in CLAUDE.md prose)", () => {
    setUnitSystem("imperial");
    expect(fmtPace(5)).toBe("8:03");        // 5 * 1.609344 = 8.047 → 8:03
    expect(fmtPace(5.801137)).toBe("9:20"); // 5.801137 * 1.609344 = 9.336 → 9:20
  });
  it("returns — for missing or implausibly slow (>30) pace", () => {
    expect(fmtPace(null)).toBe("—");
    expect(fmtPace(31)).toBe("—");
  });
});

describe("fmtWeight / fmtElevation / fmtSpeed", () => {
  it("metric", () => {
    setUnitSystem("metric");
    expect(fmtWeight(78.8)).toBe("78.8 kg");
    expect(fmtElevation(31)).toBe("31 m");
    expect(fmtSpeed(2.873)).toBe("10.3"); // 2.873 m/s → 10.3 km/h, no suffix
  });
  it("imperial (documented reference: 173.7 lb, 102 ft, 6.4 mph)", () => {
    setUnitSystem("imperial");
    expect(fmtWeight(78.8)).toBe("173.7 lb");
    expect(fmtElevation(31)).toBe("102 ft");
    expect(fmtSpeed(2.873)).toBe("6.4");
  });
  it("handles null", () => {
    expect(fmtWeight(null)).toBe("—");
    expect(fmtElevation(null)).toBe("—");
    expect(fmtSpeed(null)).toBe("—");
  });
});

describe("fmtDate", () => {
  // Built independently of fmt.ts's own implementation (same Intl call, but a
  // second instance here) so this actually catches a regression rather than
  // comparing the implementation to itself.
  const localeFormat = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" });

  it("formats a YYYY-MM-DD date using the runtime's own locale/date order", () => {
    expect(fmtDate("2026-08-01")).toBe(localeFormat.format(new Date(2026, 7, 1)));
  });
  it("parses as a LOCAL calendar date, not UTC — no timezone day-shift", () => {
    expect(fmtDate("2026-01-01")).toBe(localeFormat.format(new Date(2026, 0, 1)));
  });
  it("accepts a full timestamp (e.g. activity_date), using just its date part", () => {
    expect(fmtDate("2026-08-09T07:16:27.000")).toBe(localeFormat.format(new Date(2026, 7, 9)));
  });
  it("returns — for null/undefined/empty", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
  });
});

describe("fmtMinSecRaw (non-converting m:ss — HRA-68 dedup)", () => {
  it("formats an already-scaled minutes value as m:ss, unit-independent", () => {
    setUnitSystem("imperial"); // must NOT convert — proves it ignores the unit system
    expect(fmtMinSecRaw(5)).toBe("5:00");
    expect(fmtMinSecRaw(4.5)).toBe("4:30");
    expect(fmtMinSecRaw(6.99)).toBe("6:59"); // round(0.99*60)=59
    expect(fmtMinSecRaw(0)).toBe("0:00");
  });
  it("preserves the pre-existing seconds-rounding quirk (behaviour-preserving move, NOT a fix)", () => {
    // round((0.999)*60)=60 → "4:60" rather than rolling into "5:00". Both former
    // local copies had this identical latent quirk; the dedup must not change it.
    // A real fix is a candidate for a separate ticket, not this one.
    expect(fmtMinSecRaw(4.999)).toBe("4:60");
  });
});
