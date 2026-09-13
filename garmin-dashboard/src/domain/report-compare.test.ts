import { describe, expect, it } from "vitest";
import {
  compareDataset, compatibilityIssues, hrComparisonAvailable, pauseComparisonAvailable,
  planReportToSide, qualityComparisonAvailable, rangeReportToSide, staminaComparisonAvailable,
  type ComparisonSide,
} from "./report-compare";
import type { PlanReport, RangeReport, ReportResult } from "@/types/api";

function emptyReportResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    provenance: { instanceId: 1, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    scope: [],
    actual: { accepted: [], ambiguous: [], extra: [] },
    datasets: { original: {}, current: {}, actual: {} },
    comparisons: {},
    denominators: {},
    coverage: { totalActivitiesInScope: 0, trustedActivities: 0, ambiguousActivities: 0, extraActivities: 0 },
    drillDown: { workoutIds: [], activityIds: [] },
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

function planReport(overrides: Partial<PlanReport> = {}): PlanReport {
  return {
    provenance: { instanceId: 1, planInstanceName: "Marathon Block", scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date" },
    dateSpan: { start: "2026-08-01", end: "2026-08-31" },
    overall: emptyReportResult(),
    overallEvidence: { hr: null, pauses: null, comparableStamina: null },
    weeks: [],
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

function rangeReport(overrides: Partial<RangeReport> = {}): RangeReport {
  return {
    provenance: { from: "2026-08-01", to: "2026-08-31", range: "plan_to_date", grouping: "week", generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    instances: [],
    aggregate: {
      datasets: { original: {}, current: {}, actual: {} },
      denominators: {},
      coverage: { totalActivitiesInScope: 0, trustedActivities: 0, ambiguousActivities: 0, extraActivities: 0 },
      drillDown: { workoutIds: [], activityIds: [] },
    },
    unplanned: [],
    ambiguous: [],
    qualityEvidence: { totalWorkouts: 0, workoutsWithEvidence: 0, segments: { totalWorkSegments: 0, alignedWorkSegments: 0 }, byKind: {}, workouts: [] },
    ...overrides,
  };
}

describe("compareDataset", () => {
  it("computes a delta only when both sides have the metric (dimension isolation, never a fabricated 0)", () => {
    const a = { distanceM: 10000, durationSec: 3000, paceSecPerKm: 300 };
    const b = { distanceM: 12000, durationSec: undefined, paceSecPerKm: null };
    const result = compareDataset(a, b);

    const distance = result.find(m => m.key === "distanceM")!;
    expect(distance.availableA).toBe(true);
    expect(distance.availableB).toBe(true);
    expect(distance.absDiff).toBe(2000);
    expect(distance.pctDiff).toBeCloseTo(20);

    const duration = result.find(m => m.key === "durationSec")!;
    expect(duration.availableB).toBe(false);
    expect(duration.absDiff).toBeNull();
    expect(duration.pctDiff).toBeNull();

    const pace = result.find(m => m.key === "paceSecPerKm")!;
    expect(pace.availableA).toBe(true);
    expect(pace.availableB).toBe(false); // null is present-but-unknown, never diffed as if it were a real value
    expect(pace.absDiff).toBeNull();
  });

  it("never divides by zero into a fabricated percentage", () => {
    const result = compareDataset({ distanceM: 0 }, { distanceM: 500 });
    const distance = result.find(m => m.key === "distanceM")!;
    expect(distance.absDiff).toBe(500);
    expect(distance.pctDiff).toBeNull();
  });
});

describe("planReportToSide / rangeReportToSide", () => {
  it("a plan side never carries qualityEvidence, and a range side never carries HR/pause/stamina evidence (structural incompatibility, not a bug)", () => {
    const planSide = planReportToSide({ kind: "plan", instanceId: 1, range: "plan_to_date" }, planReport(), "Marathon Block");
    const rangeSide = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());

    expect(planSide.qualityEvidence).toBeNull();
    expect(rangeSide.evidence).toBeNull();
  });

  it("plan identity carries hasOriginalBaseline and scheduleTimezone; range identity carries grouping instead", () => {
    const planSide = planReportToSide({ kind: "plan", instanceId: 1, range: "full_plan" }, planReport({ provenance: { ...planReport().provenance, range: "full_plan" } }), "Marathon Block");
    expect(planSide.identity.hasOriginalBaseline).toBe(true);
    expect(planSide.identity.scheduleTimezone).toBe("Europe/Rome");
    expect(planSide.identity.grouping).toBeNull();
    expect(planSide.identity.range).toBe("full_plan");

    const rangeSide = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());
    expect(rangeSide.identity.grouping).toBe("week");
    expect(rangeSide.identity.hasOriginalBaseline).toBeNull();
  });
});

describe("compatibilityIssues", () => {
  const planSide = planReportToSide({ kind: "plan", instanceId: 1, range: "plan_to_date" }, planReport(), "Marathon Block");

  it("flags a different range mode prominently", () => {
    const otherRangeSide = planReportToSide(
      { kind: "plan", instanceId: 2, range: "full_plan" },
      planReport({ provenance: { ...planReport().provenance, instanceId: 2, range: "full_plan" } }),
      "Base Block",
    );
    const issues = compatibilityIssues(planSide, otherRangeSide);
    expect(issues.some(i => i.code === "range-mode")).toBe(true);
  });

  it("flags a plan-vs-range kind mismatch", () => {
    const rangeSide = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());
    const issues = compatibilityIssues(planSide, rangeSide);
    expect(issues.some(i => i.code === "kind")).toBe(true);
  });

  it("flags different durations between two ranges", () => {
    const shortRange = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-07", range: "plan_to_date" },
      rangeReport({ provenance: { ...rangeReport().provenance, from: "2026-08-01", to: "2026-08-07" } }));
    const longRange = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());
    const issues = compatibilityIssues(shortRange, longRange);
    expect(issues.some(i => i.code === "duration")).toBe(true);
  });

  it("reports no issues for two matching-shape range definitions", () => {
    const a = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());
    const b = rangeReportToSide({ kind: "range", from: "2026-07-01", to: "2026-07-31", range: "plan_to_date" },
      rangeReport({ provenance: { ...rangeReport().provenance, from: "2026-07-01", to: "2026-07-31" } }));
    expect(compatibilityIssues(a, b)).toEqual([]);
  });
});

describe("evidence availability gates (unequal/missing coverage, AC8/AC10)", () => {
  it("HR/pause/stamina are unavailable whenever either side lacks it — never partially fabricated", () => {
    const withEvidence: ComparisonSide = planReportToSide({ kind: "plan", instanceId: 1, range: "plan_to_date" }, planReport({
      overallEvidence: {
        hr: { avgHr: 140, maxHr: 170, coverage: { withHr: 2, total: 2 } },
        pauses: { pauseCount: 3, longestPauseSec: 60, totalPausedFromPausesSec: 90, details: [], hasTrackData: true },
        comparableStamina: { workout_id: "w1", activity_id: 1, reason: "longest_run", stamina: { firstValid: 100, finish: 60, depletionPoints: 40, minimum: 55, coverage: { withStamina: 10, total: 10 } } },
      },
    }), "With evidence");
    const withoutEvidence: ComparisonSide = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());

    expect(hrComparisonAvailable(withEvidence, withoutEvidence)).toBe(false);
    expect(pauseComparisonAvailable(withEvidence, withoutEvidence)).toBe(false);
    expect(staminaComparisonAvailable(withEvidence, withoutEvidence)).toBe(false);
    // Symmetric: both being plan sides WITH evidence is the only "available" case.
    expect(hrComparisonAvailable(withEvidence, withEvidence)).toBe(true);
    expect(pauseComparisonAvailable(withEvidence, withEvidence)).toBe(true);
    expect(staminaComparisonAvailable(withEvidence, withEvidence)).toBe(true);
  });

  it("quality-workout comparison requires both sides to carry real HRA-342 evidence with at least one session", () => {
    const emptyQuality = rangeReportToSide({ kind: "range", from: "2026-08-01", to: "2026-08-31", range: "plan_to_date" }, rangeReport());
    const withQuality = rangeReportToSide({ kind: "range", from: "2026-07-01", to: "2026-07-31", range: "plan_to_date" }, rangeReport({
      provenance: { ...rangeReport().provenance, from: "2026-07-01", to: "2026-07-31" },
      qualityEvidence: {
        totalWorkouts: 1, workoutsWithEvidence: 1, segments: { totalWorkSegments: 4, alignedWorkSegments: 4 },
        byKind: { repetition: { total: 1, withEvidence: 1 } },
        workouts: [],
      },
    }));
    const planSide = planReportToSide({ kind: "plan", instanceId: 1, range: "plan_to_date" }, planReport(), "Marathon Block");

    expect(qualityComparisonAvailable(emptyQuality, withQuality)).toBe(false);
    expect(qualityComparisonAvailable(withQuality, withQuality)).toBe(true);
    expect(qualityComparisonAvailable(planSide, withQuality)).toBe(false); // plan side never carries qualityEvidence at all
  });
});
