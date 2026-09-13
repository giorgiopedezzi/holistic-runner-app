/**
 * PlanReportModal.test.tsx (HRA-338)
 * Behavior net for the entire-plan report modal, plus its drill-down chain
 * into WeekReportModal and the existing WorkoutReportModal (HRA-336) — each
 * step stubs its own GET route, same installFetch/api-stub pattern as
 * WorkoutReportModal.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanReportModal } from "./PlanReportModal";
import { installFetch, json, problem, type StubRequest } from "@/test/api-stub";
import type { PlanReport, WeekReport, WorkoutReport } from "@/types/api";

const INSTANCE_ID = 10;

function emptyReportResult() {
  return {
    provenance: { instanceId: INSTANCE_ID, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    scope: [],
    actual: { accepted: [], ambiguous: [], extra: [] },
    datasets: { original: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 }, current: { distanceM: 22000, approximate: false, durationSec: 6600, paceSecPerKm: 300 }, actual: {} },
    comparisons: {},
    denominators: { execution: { total: 2, completed: 1, missed: 1, upcoming: 0 } },
    coverage: { totalActivitiesInScope: 0, trustedActivities: 0, ambiguousActivities: 0, extraActivities: 0 },
    drillDown: { workoutIds: [], activityIds: [] },
    structuredQualityEvidence: { available: false as const, reason: "not_implemented" as const },
  };
}

function planReport(overrides: Partial<PlanReport> = {}): PlanReport {
  return {
    provenance: { instanceId: INSTANCE_ID, planInstanceName: "Marathon Block", scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date" },
    dateSpan: { start: "2026-09-10", end: "2026-09-23" },
    overall: emptyReportResult(),
    overallEvidence: { hr: null, pauses: null, comparableStamina: null },
    weeks: [
      { key: { section_name: "Base", week_number: 1 }, dateSpan: { start: "2026-09-10", end: "2026-09-16" }, report: { ...emptyReportResult(), datasets: { ...emptyReportResult().datasets, current: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 } } }, evidence: { hr: null, pauses: null, comparableStamina: null } },
      { key: { section_name: "Base", week_number: 2 }, dateSpan: { start: "2026-09-17", end: "2026-09-23" }, report: { ...emptyReportResult(), datasets: { ...emptyReportResult().datasets, current: { distanceM: 12000, approximate: false, durationSec: 3600, paceSecPerKm: 300 } } }, evidence: { hr: null, pauses: null, comparableStamina: null } },
    ],
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

function weekReport(weekNumber: number): WeekReport {
  return {
    provenance: { instanceId: INSTANCE_ID, planInstanceName: "Marathon Block", sectionName: "Base", weekNumber, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date" },
    dateSpan: { start: "2026-09-10", end: "2026-09-16" },
    report: emptyReportResult(),
    workouts: [{ workoutId: "w1", sectionName: "Base", weekNumber, day: 1, workoutType: "run", originalDate: "2026-09-10", currentDate: "2026-09-10" }],
    evidence: { hr: null, pauses: null, comparableStamina: null },
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
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
  };
}

const PLAN_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/plan`;
const WEEK_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/weeks`;
const WORKOUT_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/workouts/w1`;

describe("PlanReportModal", () => {
  it("renders the overall total and every week, ordered as returned", async () => {
    installFetch({ [PLAN_ROUTE]: json(planReport()) });
    render(<PlanReportModal instanceId={INSTANCE_ID} onClose={() => {}} />);

    expect(await screen.findByText("22.00 km")).toBeInTheDocument(); // overall Current total
    expect(screen.getByText(/Week 1/)).toBeInTheDocument();
    expect(screen.getByText(/Week 2/)).toBeInTheDocument();
  });

  it("drills down: clicking a week opens WeekReportModal, clicking a workout there opens WorkoutReportModal", async () => {
    installFetch({
      [PLAN_ROUTE]: json(planReport()),
      [WEEK_ROUTE]: (req: StubRequest) => json(weekReport(Number(req.url.searchParams.get("week_number")))),
      [WORKOUT_ROUTE]: json(workoutReport()),
    });
    render(<PlanReportModal instanceId={INSTANCE_ID} onClose={() => {}} />);

    fireEvent.click(await screen.findByText(/Week 1/));
    expect(await screen.findByText("Week 1 report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /run/ }));
    expect(await screen.findByText("Original plan unchanged")).toBeInTheDocument();
  });

  it("shows the empty state when the plan has no weeks yet", async () => {
    installFetch({ [PLAN_ROUTE]: json(planReport({ weeks: [] })) });
    render(<PlanReportModal instanceId={INSTANCE_ID} onClose={() => {}} />);

    expect(await screen.findByText("This plan has no weeks yet.")).toBeInTheDocument();
  });

  it("renders an error banner when the fetch fails", async () => {
    installFetch({ [PLAN_ROUTE]: problem(404, "No plan instance found.") });
    render(<PlanReportModal instanceId={INSTANCE_ID} onClose={() => {}} />);

    expect(await screen.findByText("No plan instance found.")).toBeInTheDocument();
  });
});
