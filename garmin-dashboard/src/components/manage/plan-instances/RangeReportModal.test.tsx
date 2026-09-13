/**
 * RangeReportModal.test.tsx (HRA-341)
 * Behavior net for the date-range/race-range report modal, plus its
 * drill-down chain into the EXISTING PlanReportModal (per included plan
 * instance) and the EXISTING WorkoutReportModal (per quality workout) — same
 * installFetch/api-stub pattern as PlanReportModal.test.tsx.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RangeReportModal } from "./RangeReportModal";
import { installFetch, json, problem } from "@/test/api-stub";
import type { PlanReport, RangeReport, ReportResult, WorkoutReport } from "@/types/api";

// HRA-339: the modal's own drill-down/toggle state (and its nested
// PlanReportModal's) is now URL-backed (useUrlState) — reset between tests
// so a value written by one doesn't leak into the next.
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const FROM = "2026-09-01";
const TO = "2026-09-30";
const INSTANCE_ID = 10;

function emptyReportResult(): ReportResult {
  return {
    provenance: { instanceId: INSTANCE_ID, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    scope: [],
    actual: { accepted: [], ambiguous: [], extra: [] },
    datasets: { original: {}, current: { distanceM: 22000, approximate: false, durationSec: 6600, paceSecPerKm: 300 }, actual: {} },
    comparisons: {},
    denominators: { execution: { total: 2, completed: 1, missed: 1, upcoming: 0 } },
    coverage: { totalActivitiesInScope: 0, trustedActivities: 0, ambiguousActivities: 0, extraActivities: 0 },
    drillDown: { workoutIds: [], activityIds: [] },
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
  };
}

function rangeReport(overrides: Partial<RangeReport> = {}): RangeReport {
  return {
    provenance: { from: FROM, to: TO, range: "plan_to_date", grouping: "workout", generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    instances: [
      { instanceId: INSTANCE_ID, planInstanceName: "Marathon Block", scheduleTimezone: "Europe/Rome", dateSpan: { start: FROM, end: TO }, report: emptyReportResult() },
    ],
    aggregate: {
      datasets: { original: {}, current: { distanceM: 22000, approximate: false, durationSec: 6600, paceSecPerKm: 300 }, actual: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 } },
      denominators: { execution: { total: 2, completed: 1, missed: 1, upcoming: 0 } },
      coverage: { totalActivitiesInScope: 1, trustedActivities: 1, ambiguousActivities: 0, extraActivities: 0 },
      drillDown: { workoutIds: ["w1"], activityIds: [1] },
    },
    unplanned: [],
    ambiguous: [],
    qualityEvidence: { totalWorkouts: 0, workoutsWithEvidence: 0, segments: { totalWorkSegments: 0, alignedWorkSegments: 0 }, byKind: {}, workouts: [] },
    ...overrides,
  };
}

function planReport(): PlanReport {
  return {
    provenance: { instanceId: INSTANCE_ID, planInstanceName: "Marathon Block", scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date" },
    dateSpan: { start: FROM, end: TO },
    overall: emptyReportResult(),
    overallEvidence: { hr: null, pauses: null, comparableStamina: null },
    weeks: [],
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
  };
}

function workoutReport(): WorkoutReport {
  return {
    provenance: { planInstanceId: INSTANCE_ID, planInstanceName: "Marathon Block", workoutId: "w1", originalRevision: 1, currentRevision: 1, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    identity: { sectionName: "Base", weekNumber: 1, day: 1, workoutType: "run", originalDate: "2026-09-10", currentDate: "2026-09-10" },
    lineage: "unchanged",
    originalEqualsCurrent: true,
    state: "missed",
    planned: { original: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 }, current: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 } },
    actual: { metrics: null, evidence: [], hasAmbiguousEvidence: false },
    race: { isRace: false },
    hr: null, stamina: null, pauses: null,
    structuredQualityEvidence: { available: false, reason: "not_applicable" },
  };
}

const RANGE_ROUTE = "GET /api/v1/reports/range";
const PLAN_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/plan`;
const WORKOUT_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/workouts/w1`;

describe("RangeReportModal", () => {
  it("renders the aggregate totals and the included plan instance", async () => {
    installFetch({ [RANGE_ROUTE]: json(rangeReport()) });
    render(<RangeReportModal from={FROM} to={TO} onClose={() => {}} />);

    expect(await screen.findByText("Execution: 1 completed, 1 missed of 2")).toBeInTheDocument(); // aggregate denominators
    expect(screen.getAllByText("22.00 km").length).toBeGreaterThan(0); // aggregate Current total (also echoed on the instance row)
    expect(screen.getByText(/Marathon Block/)).toBeInTheDocument();
  });

  it("drills down: clicking an included plan instance opens the EXISTING PlanReportModal", async () => {
    installFetch({ [RANGE_ROUTE]: json(rangeReport()), [PLAN_ROUTE]: json(planReport()) });
    render(<RangeReportModal from={FROM} to={TO} onClose={() => {}} />);

    fireEvent.click(await screen.findByText(/Marathon Block/));
    expect(await screen.findByText("Plan report")).toBeInTheDocument();
  });

  it("drills down: clicking a quality workout opens the EXISTING WorkoutReportModal", async () => {
    installFetch({
      [RANGE_ROUTE]: json(rangeReport({
        qualityEvidence: {
          totalWorkouts: 1, workoutsWithEvidence: 0,
          segments: { totalWorkSegments: 4, alignedWorkSegments: 0 }, byKind: { repetition: { total: 1, withEvidence: 0 } },
          workouts: [{
            instanceId: INSTANCE_ID, workoutId: "w1", planInstanceName: "Marathon Block", sectionName: "Base", weekNumber: 1, day: 1, currentDate: "2026-09-10",
            comparison: {
              kind: "repetition", available: false, segments: [],
              totals: { plannedWorkDistanceM: 3000, plannedWorkDurationSec: 900, actualWorkDistanceM: 0, actualWorkDurationSec: 0, weightedActualPaceSecPerKm: null, paceSpreadSecPerKm: null, progressivelyFaster: null, coverage: { totalWorkSegments: 4, alignedWorkSegments: 0 } },
              wholeSessionPaceSecPerKm: null,
            },
          }],
        },
      })),
      [WORKOUT_ROUTE]: json(workoutReport()),
    });
    render(<RangeReportModal from={FROM} to={TO} onClose={() => {}} />);

    // First click expands the AccordionCard ("Repetitions / blocks" title);
    // its panel then reveals the quality workout row itself, whose own
    // accessible name ALSO contains "Repetitions" (the workout's kind
    // label) — so after expansion there are two matching buttons, the
    // trigger (still in the DOM, index 0) and the row (index 1).
    fireEvent.click(await screen.findByText("Repetitions / blocks"));
    const repetitionButtons = await screen.findAllByRole("button", { name: /Repetitions/ });
    fireEvent.click(repetitionButtons[1]);
    expect(await screen.findByText("Original plan unchanged")).toBeInTheDocument();
  });

  it("shows the no-plans empty state when no instance overlaps the range", async () => {
    installFetch({ [RANGE_ROUTE]: json(rangeReport({ instances: [] })) });
    render(<RangeReportModal from={FROM} to={TO} onClose={() => {}} />);

    expect(await screen.findByText(/No plan instance falls inside this range/)).toBeInTheDocument();
  });

  it("renders an error banner when the fetch fails", async () => {
    installFetch({ [RANGE_ROUTE]: problem(400, "from must not be after to.") });
    render(<RangeReportModal from={FROM} to={TO} onClose={() => {}} />);

    expect(await screen.findByText("from must not be after to.")).toBeInTheDocument();
  });
});
