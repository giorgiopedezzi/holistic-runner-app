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
import { defaultGroupMode, isoWeekStart, buildTrendPoints, meanCenteredDomain, swimPacePer100m, groupActivitiesBySport, buildOverlapPoints } from "./trends";

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

describe("buildOverlapPoints — Overview & Trends' overlapped current-vs-compare chart", () => {
  const FROM = "2026-01-01";      // current period start
  const CFROM = "2026-02-01";     // compare period start, unrelated calendar month
  const atDay = (base: string, d: number, id: number) => activity({ id, date_only: addDays(base, d) });
  // buildOverlapPoints takes TrendPoint[], the same shape Single/Week/Month
  // all reduce to via buildTrendPoints — "single" here just gives one point
  // per activity, exercising the per-activity-granularity case.
  const single = (acts: Activity[]) => buildTrendPoints(acts, "single");

  it("\"index\": positional 1:1 pairing, longer side's leftovers trail with only their own side filled", () => {
    const cur = single([0, 1, 2].map(d => atDay(FROM, d, d + 1)));       // 3 current activities
    const cmp = single([0, 1].map(d => atDay(CFROM, d, d + 100)));       // 2 compare activities
    const points = buildOverlapPoints(cur, cmp, FROM, CFROM, "index");
    expect(points).toHaveLength(3);
    expect(points[0].currentLabel).not.toBeNull();
    expect(points[0].compareLabel).not.toBeNull();
    expect(points[2].currentLabel).not.toBeNull();
    expect(points[2].compareLabel).toBeNull(); // leftover current activity, no compare side
  });

  it("\"time\": pinned spec example — current days [0,2,5,9] vs compare days [0,3,8] -> 6 slots, only the first overlaps", () => {
    const cur = single([0, 2, 5, 9].map(d => atDay(FROM, d, d + 1)));
    const cmp = single([0, 3, 8].map(d => atDay(CFROM, d, d + 100)));
    const points = buildOverlapPoints(cur, cmp, FROM, CFROM, "time");

    expect(points).toHaveLength(6);
    const overlapping = points.filter(p => p.currentLabel != null && p.compareLabel != null);
    expect(overlapping).toHaveLength(1);
    expect(points[0].currentLabel).not.toBeNull();
    expect(points[0].compareLabel).not.toBeNull(); // day 0 == day 0, the one shared slot
    // Chronological day-offset order: day2(cur), day3(cmp), day5(cur), day8(cmp), day9(cur).
    const sides = points.slice(1).map(p => (p.currentLabel != null ? "current" : "compare"));
    expect(sides).toEqual(["current", "compare", "current", "compare", "current"]);
  });

  it("\"time\": exact equality only — a 1-day difference does not merge into one slot", () => {
    const cur = single([atDay(FROM, 2, 1)]);
    const cmp = single([atDay(CFROM, 3, 101)]);
    const points = buildOverlapPoints(cur, cmp, FROM, CFROM, "time");
    expect(points).toHaveLength(2);
    expect(points.every(p => p.currentLabel == null || p.compareLabel == null)).toBe(true);
  });

  it("\"index\" also pairs Week-mode points positionally — position IS the period-relative slot there", () => {
    // 3 current weeks vs 2 compare weeks (spaced >7 days apart so each
    // activity lands in its own ISO week).
    const cur = buildTrendPoints([0, 8, 16].map(d => atDay(FROM, d, d + 1)), "week");
    const cmp = buildTrendPoints([0, 8].map(d => atDay(CFROM, d, d + 100)), "week");
    const points = buildOverlapPoints(cur, cmp, FROM, CFROM, "index");
    expect(points).toHaveLength(3);
    expect(points[2].compareLabel).toBeNull();
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
