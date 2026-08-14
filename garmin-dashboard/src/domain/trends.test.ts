/**
 * domain/trends.test.ts  (HRA-70)
 * Pins the documented invariants from docs/frontend.md's "Overview tab"
 * section: week/month grouping reconciles to the same real total (429.77 km
 * over a 65-activity range), the swim pace-per-100m conversion (23.21 ->
 * 2.32), and defaultGroupMode's day-count boundaries.
 */
import { describe, it, expect } from "vitest";
import type { Activity } from "@/types/api";
import { activity } from "@/test/fixtures";
import { defaultGroupMode, isoWeekStart, buildTrendPoints, meanCenteredDomain, swimPacePer100m, groupActivitiesBySport } from "./trends";

function addDays(dateOnly: string, days: number): string {
  return new Date(new Date(`${dateOnly}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("defaultGroupMode", () => {
  const FROM = "2026-01-01";
  it("<=21 days -> single, <=120 -> week, else month", () => {
    expect(defaultGroupMode(FROM, addDays(FROM, 21))).toBe("single");
    expect(defaultGroupMode(FROM, addDays(FROM, 22))).toBe("week");
    expect(defaultGroupMode(FROM, addDays(FROM, 120))).toBe("week");
    expect(defaultGroupMode(FROM, addDays(FROM, 121))).toBe("month");
  });
});

describe("isoWeekStart", () => {
  it("returns the Monday of the ISO week (2024-01-01 was itself a Monday)", () => {
    expect(isoWeekStart("2024-01-01")).toBe("2024-01-01");
    expect(isoWeekStart("2024-01-07")).toBe("2024-01-01"); // the following Sunday, same ISO week
    expect(isoWeekStart("2024-01-08")).toBe("2024-01-08"); // the next Monday
  });
});

describe("buildTrendPoints — the documented reconciliation invariant", () => {
  // 65 activities whose distances sum to exactly 429,770 m (429.77 km), the
  // real running range documented in docs/frontend.md. Spread ~3 days apart
  // (~195 days total) so week/month grouping is non-trivial.
  const N = 65;
  const TOTAL_M = 429_770;
  const base = Math.floor(TOTAL_M / N);
  const distances = Array.from({ length: N }, (_, i) => (i === N - 1 ? TOTAL_M - base * (N - 1) : base));
  const activities: Activity[] = distances.map((d, i) =>
    activity({ id: i + 1, date_only: addDays("2025-01-01", i * 3), distance_m: d, avg_pace_minkm: 5, avg_hr: 150 }));

  const sumKm = (mode: "single" | "week" | "month") =>
    buildTrendPoints(activities, mode).reduce((s, p) => s + p.totalKm, 0);

  it("single/week/month grouping all reconcile to the same 429.77 km total", () => {
    expect(sumKm("single")).toBeCloseTo(429.77, 2);
    expect(sumKm("week")).toBeCloseTo(429.77, 2);
    expect(sumKm("month")).toBeCloseTo(429.77, 2);
  });

  it("week grouping buckets by ISO week (fewer points than single mode)", () => {
    const single = buildTrendPoints(activities, "single");
    const week = buildTrendPoints(activities, "week");
    expect(week.length).toBeLessThan(single.length);
    expect(single).toHaveLength(N);
  });
});

describe("meanCenteredDomain", () => {
  it("returns [0,1] for empty input, else a symmetric band around the mean", () => {
    expect(meanCenteredDomain([])).toEqual([0, 1]);
    const [lo, hi] = meanCenteredDomain([140, 150, 160]);
    expect(hi - 150).toBeCloseTo(150 - lo, 6); // symmetric around the mean
  });
});

describe("swimPacePer100m — pinned conversion (AC)", () => {
  it("23.21 min/km -> 2.32 min/100m", () => {
    expect(Math.round(swimPacePer100m(23.21) * 100) / 100).toBe(2.32);
  });
});

describe("groupActivitiesBySport (HRA-78)", () => {
  it("groups by sport and orders sports by total distance, descending", () => {
    const acts = [
      activity({ id: 1, sport: "cycling", distance_m: 5000 }),
      activity({ id: 2, sport: "running", distance_m: 3000 }),
      activity({ id: 3, sport: "running", distance_m: 4000 }),
      activity({ id: 4, sport: null, distance_m: 1000 }),
    ];
    const grouped = groupActivitiesBySport(acts);

    expect(grouped.map(([sport]) => sport)).toEqual(["running", "cycling", "other"]);
    expect(grouped.find(([sport]) => sport === "running")?.[1]).toHaveLength(2);
  });
});
