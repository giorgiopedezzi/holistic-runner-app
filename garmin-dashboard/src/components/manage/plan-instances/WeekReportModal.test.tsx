/**
 * WeekReportModal.test.tsx (HRA-338)
 * Behavior net for the week report modal — mounted standalone against a
 * stubbed GET .../reports/weeks response, same installFetch/api-stub pattern
 * as WorkoutReportModal.test.tsx.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeekReportModal } from "./WeekReportModal";
import { installFetch, json, problem } from "@/test/api-stub";
import type { WeekReport } from "@/types/api";

const INSTANCE_ID = 10;
const SECTION_NAME = "Base";
const WEEK_NUMBER = 1;

function weekReport(overrides: Partial<WeekReport> = {}): WeekReport {
  return {
    provenance: {
      instanceId: INSTANCE_ID, planInstanceName: "Marathon Block", sectionName: SECTION_NAME, weekNumber: WEEK_NUMBER,
      scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true,
      generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date",
    },
    dateSpan: { start: "2026-09-10", end: "2026-09-16" },
    report: {
      provenance: { instanceId: INSTANCE_ID, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
      scope: [{ workout_id: "w1", lineage: "unchanged", originalInRange: true, currentInRange: true, boundaryMovement: "stable" }],
      actual: { accepted: [], ambiguous: [], extra: [] },
      datasets: { original: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 }, current: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 }, actual: {} },
      comparisons: { execution: [{ workout_id: "w1", scheduled_date: "2026-09-10", state: "missed", evidence: null, includedInDenominator: true }] },
      denominators: { execution: { total: 1, completed: 0, missed: 1, upcoming: 0 } },
      coverage: { totalActivitiesInScope: 0, trustedActivities: 0, ambiguousActivities: 0, extraActivities: 0 },
      drillDown: { workoutIds: ["w1"], activityIds: [] },
      structuredQualityEvidence: { available: false, reason: "not_implemented" },
    },
    workouts: [{ workoutId: "w1", sectionName: SECTION_NAME, weekNumber: WEEK_NUMBER, day: 1, workoutType: "run", originalDate: "2026-09-10", currentDate: "2026-09-10" }],
    evidence: { hr: null, pauses: null, comparableStamina: null },
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

const ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/weeks`;

describe("WeekReportModal", () => {
  it("renders week datasets, a workout row, and the execution summary", async () => {
    installFetch({ [ROUTE]: json(weekReport()) });
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} />);

    expect(await screen.findByText("Week 1 report")).toBeInTheDocument();
    expect(screen.getAllByText("10.00 km")).toHaveLength(2); // Original and Current datasets, same value
    expect(screen.getByText("Execution: 0 completed, 1 missed of 1")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
  });

  it("shows the explicit quality-workout unavailable note (HRA-342 not yet built)", async () => {
    installFetch({ [ROUTE]: json(weekReport()) });
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} />);

    expect(await screen.findByText(/Structured quality-workout comparison isn't available yet/)).toBeInTheDocument();
  });

  it("shows a moved badge for a workout whose lineage isn't unchanged", async () => {
    installFetch({
      [ROUTE]: json(weekReport({
        report: {
          ...weekReport().report,
          scope: [{ workout_id: "w1", lineage: "moved", originalInRange: true, currentInRange: false, boundaryMovement: "moved_out" }],
        },
      })),
    });
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} />);

    expect(await screen.findByText("Moved")).toBeInTheDocument();
  });

  it("renders the comparable-stamina reason (never a blended average) when present", async () => {
    installFetch({
      [ROUTE]: json(weekReport({
        evidence: {
          hr: null, pauses: null,
          comparableStamina: { workout_id: "w1", activity_id: 1, reason: "longest_run", stamina: { firstValid: 80, finish: 40, depletionPoints: 40, minimum: 38, coverage: { withStamina: 5, total: 5 } } },
        },
      })),
    });
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} />);

    expect(await screen.findByText("From this scope's own longest run")).toBeInTheDocument();
    expect(screen.getByText("40 pts")).toBeInTheDocument();
  });

  it("calls onOpenWorkout with the clicked workout's id", async () => {
    installFetch({ [ROUTE]: json(weekReport()) });
    const onOpenWorkout = vi.fn();
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} onOpenWorkout={onOpenWorkout} />);

    const row = await screen.findByRole("button", { name: /run/ });
    fireEvent.click(row);
    expect(onOpenWorkout).toHaveBeenCalledWith("w1");
  });

  it("renders an error banner when the fetch fails", async () => {
    installFetch({ [ROUTE]: problem(404, "No week found.") });
    render(<WeekReportModal instanceId={INSTANCE_ID} sectionName={SECTION_NAME} weekNumber={WEEK_NUMBER} onClose={() => {}} />);

    expect(await screen.findByText("No week found.")).toBeInTheDocument();
  });
});
