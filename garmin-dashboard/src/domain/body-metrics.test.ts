/**
 * domain/body-metrics.test.ts  (HRA-70)
 */
import { describe, it, expect, afterEach } from "vitest";
import { setUnitSystem } from "@/utils/units";
import { bodyMeasurement } from "@/test/fixtures";
import { metricUnit, convertRow, computeKgDelta } from "./body-metrics";

afterEach(() => setUnitSystem("metric"));

describe("metricUnit", () => {
  it("weight-family keys follow the unit system; others are fixed", () => {
    setUnitSystem("metric");
    expect(metricUnit("weight_kg")).toBe("kg");
    setUnitSystem("imperial");
    expect(metricUnit("weight_kg")).toBe("lb");
    expect(metricUnit("fat_ratio")).toBe("%");
    expect(metricUnit("bmi")).toBe("");
    expect(metricUnit("heart_rate")).toBe("bpm");
  });
});

describe("convertRow", () => {
  it("passes through unchanged under metric", () => {
    setUnitSystem("metric");
    const row = { date_only: "2026-08-01", weight_kg: 72.4, fat_ratio: 14.2 };
    expect(convertRow(row)).toEqual(row);
  });
  it("converts only weight-family fields under imperial, leaves others untouched", () => {
    setUnitSystem("imperial");
    const row = { date_only: "2026-08-01", weight_kg: 72.4, fat_ratio: 14.2, bmi: 22.4 };
    const out = convertRow(row);
    expect(out.weight_kg).toBeCloseTo(159.6, 1); // 72.4 kg -> lb
    expect(out.fat_ratio).toBe(14.2); // not a weight-family key
    expect(out.bmi).toBe(22.4);
  });
  it("skips null fields", () => {
    setUnitSystem("imperial");
    expect(convertRow({ date_only: "2026-08-01", weight_kg: null })).toEqual({ date_only: "2026-08-01", weight_kg: null });
  });
});

describe("computeKgDelta", () => {
  it("computes change from the first non-null reading per key", () => {
    const list = [
      bodyMeasurement({ date_only: "2026-08-01", weight_kg: 80, fat_mass_kg: 12 }),
      bodyMeasurement({ date_only: "2026-08-08", weight_kg: 79, fat_mass_kg: 11.5 }),
      bodyMeasurement({ date_only: "2026-08-15", weight_kg: 78, fat_mass_kg: 11 }),
    ];
    const rows = computeKgDelta(list, ["weight_kg", "fat_mass_kg"]);
    expect(rows[0]).toEqual({ date_only: "2026-08-01", weight_kg: 0, fat_mass_kg: 0 });
    expect(rows[1].weight_kg).toBeCloseTo(-1, 5);
    expect(rows[2].weight_kg).toBeCloseTo(-2, 5);
    expect(rows[2].fat_mass_kg).toBeCloseTo(-1, 5);
  });
  it("uses the first non-null reading as baseline when the earliest is missing that key", () => {
    const list = [
      bodyMeasurement({ date_only: "2026-08-01", weight_kg: null }),
      bodyMeasurement({ date_only: "2026-08-08", weight_kg: 80 }),
      bodyMeasurement({ date_only: "2026-08-15", weight_kg: 78 }),
    ];
    const rows = computeKgDelta(list, ["weight_kg"]);
    expect(rows[0].weight_kg).toBeNull(); // no baseline yet
    expect(rows[1].weight_kg).toBe(0);    // this IS the baseline
    expect(rows[2].weight_kg).toBeCloseTo(-2, 5);
  });
});
