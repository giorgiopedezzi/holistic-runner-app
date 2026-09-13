/**
 * CompareReportsModal.test.tsx (HRA-340)
 * Behavior net for "compare two complete report definitions" — dimension
 * isolation (never blending datasets across sides), incompatible-metric
 * labeling, unequal coverage staying visible on both sides, HR/pause/stamina
 * availability gated on both sides actually carrying it, structured
 * quality-workout comparison likewise, drill-down into the EXISTING
 * PlanReportModal/RangeReportModal, and no fabricated score anywhere.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CompareReportsModal } from "./CompareReportsModal";
import { installFetch, json, paginated } from "@/test/api-stub";
import type { PlanInstance, PlanReport, RangeReport, ReportResult } from "@/types/api";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const INSTANCE_A = 10;
const INSTANCE_B = 20;
const FROM = "2026-08-01";
const TO = "2026-08-31";

function emptyReportResult(overrides: Partial<ReportResult> = {}, instanceId = INSTANCE_A): ReportResult {
  return {
    provenance: { instanceId, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    scope: [],
    actual: { accepted: [], ambiguous: [], extra: [] },
    datasets: { original: {}, current: { distanceM: 20000, approximate: false, durationSec: 6000, paceSecPerKm: 300 }, actual: {} },
    comparisons: {},
    denominators: { execution: { total: 2, completed: 1, missed: 1, upcoming: 0 } },
    coverage: { totalActivitiesInScope: 1, trustedActivities: 1, ambiguousActivities: 0, extraActivities: 0 },
    drillDown: { workoutIds: [], activityIds: [] },
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

function planReport(name: string, instanceId: number, overrides: Partial<PlanReport> = {}): PlanReport {
  return {
    provenance: { instanceId, planInstanceName: name, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true, generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z", range: "plan_to_date" },
    dateSpan: { start: FROM, end: TO },
    overall: emptyReportResult({}, instanceId),
    overallEvidence: { hr: null, pauses: null, comparableStamina: null },
    weeks: [],
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

function rangeReport(from: string, to: string, overrides: Partial<RangeReport> = {}): RangeReport {
  return {
    provenance: { from, to, range: "plan_to_date", grouping: "week", generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z" },
    instances: [],
    aggregate: {
      datasets: { original: {}, current: { distanceM: 15000, approximate: false, durationSec: 5000, paceSecPerKm: 320 }, actual: { distanceM: 8000, approximate: false, durationSec: 2500, paceSecPerKm: 310 } },
      denominators: { execution: { total: 3, completed: 2, missed: 1, upcoming: 0 } },
      coverage: { totalActivitiesInScope: 2, trustedActivities: 2, ambiguousActivities: 0, extraActivities: 0 },
      drillDown: { workoutIds: [], activityIds: [] },
    },
    unplanned: [],
    ambiguous: [],
    qualityEvidence: { totalWorkouts: 0, workoutsWithEvidence: 0, segments: { totalWorkSegments: 0, alignedWorkSegments: 0 }, byKind: {}, workouts: [] },
    ...overrides,
  };
}

function planInstance(id: number, name: string): PlanInstance {
  return {
    id, template_id: 1, start_date: FROM, pace_overrides: null, target_activity_id: null, approved_at: "2026-07-01T00:00:00Z",
    name, event: null, race_name: null, race_date: null, race_url: null, current_revision: 1, original_revision: 1,
  } as PlanInstance;
}

const INSTANCES_ROUTE = "GET /api/v1/plan-instances";
const PLAN_A_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_A}/reports/plan`;
const PLAN_B_ROUTE = `GET /api/v1/plan-instances/${INSTANCE_B}/reports/plan`;
const RANGE_ROUTE = "GET /api/v1/reports/range";

describe("CompareReportsModal", () => {
  it("renders both sides' identity and a compatible metric comparison with a delta", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=plan&compareBInstance=20");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block"), planInstance(INSTANCE_B, "Base Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A)),
      [PLAN_B_ROUTE]: json(planReport("Base Block", INSTANCE_B, {
        overall: emptyReportResult({ datasets: { original: {}, current: { distanceM: 25000, approximate: false, durationSec: 7000, paceSecPerKm: 280 }, actual: {} } }, INSTANCE_B),
      })),
    });

    render(<CompareReportsModal onClose={() => {}} />);

    // "Marathon Block"/"Base Block" legitimately appear twice each — once in
    // the picker's own Select trigger, once in the loaded identity panel.
    expect((await screen.findAllByText("Marathon Block")).length).toBeGreaterThanOrEqual(2);
    expect((await screen.findAllByText("Base Block")).length).toBeGreaterThanOrEqual(2);
    // Current dataset: A=20.00km, B=25.00km -> delta +5.00km (+25.0%)
    expect(await screen.findByText(/\+5\.00 km \(\+25\.0%\)/)).toBeInTheDocument();
  });

  it("labels an incompatible pairing prominently instead of a silent diff (different report kinds)", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=range&compareBFrom=2026-08-01&compareBTo=2026-08-31");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A)),
      [RANGE_ROUTE]: json(rangeReport(FROM, TO)),
    });

    render(<CompareReportsModal onClose={() => {}} />);

    expect(await screen.findByText(/Comparing a plan report with a range report/)).toBeInTheDocument();
  });

  it("never blends a different-length range's totals silently — flags the duration mismatch", async () => {
    window.history.replaceState(null, "", "/?compareAKind=range&compareAFrom=2026-08-01&compareATo=2026-08-07&compareBKind=range&compareBFrom=2026-08-01&compareBTo=2026-08-31");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([])),
      "GET /api/v1/reports/range": (req: { url: URL }) => {
        const from = req.url.searchParams.get("from");
        const to = req.url.searchParams.get("to");
        return json(rangeReport(from!, to!));
      },
    });

    render(<CompareReportsModal onClose={() => {}} />);

    expect(await screen.findByText(/Report A spans 7 day\(s\), Report B spans 31 day\(s\)/)).toBeInTheDocument();
  });

  it("shows HR/pause/stamina as unavailable when one side is a Range report (no aggregate evidence computed there)", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=range&compareBFrom=2026-08-01&compareBTo=2026-08-31");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A, {
        overallEvidence: { hr: { avgHr: 140, maxHr: 170, coverage: { withHr: 1, total: 1 } }, pauses: null, comparableStamina: null },
      })),
      [RANGE_ROUTE]: json(rangeReport(FROM, TO)),
    });

    render(<CompareReportsModal onClose={() => {}} />);

    expect(await screen.findByText(/need both sides to be Plan reports with recorded evidence/)).toBeInTheDocument();
  });

  it("shows real pause/HR evidence side by side when both sides are Plan reports that carry it", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=plan&compareBInstance=20");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block"), planInstance(INSTANCE_B, "Base Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A, {
        overallEvidence: {
          hr: { avgHr: 140, maxHr: 170, coverage: { withHr: 1, total: 1 } },
          pauses: { pauseCount: 3, longestPauseSec: 90, totalPausedFromPausesSec: 180, details: [], hasTrackData: true },
          comparableStamina: null,
        },
      })),
      [PLAN_B_ROUTE]: json(planReport("Base Block", INSTANCE_B, {
        overallEvidence: {
          hr: { avgHr: 130, maxHr: 160, coverage: { withHr: 1, total: 1 } },
          pauses: { pauseCount: 1, longestPauseSec: 30, totalPausedFromPausesSec: 30, details: [], hasTrackData: true },
          comparableStamina: null,
        },
      })),
    });

    render(<CompareReportsModal onClose={() => {}} />);

    // Both sides' real pause counts render (never merged/blended into one).
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.queryByText(/need both sides to be Plan reports with recorded evidence/)).not.toBeInTheDocument();
  });

  it("shows unequal coverage truthfully on both sides rather than merging it", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=plan&compareBInstance=20");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block"), planInstance(INSTANCE_B, "Base Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A, {
        overall: emptyReportResult({ coverage: { totalActivitiesInScope: 5, trustedActivities: 5, ambiguousActivities: 0, extraActivities: 0 } }, INSTANCE_A),
      })),
      [PLAN_B_ROUTE]: json(planReport("Base Block", INSTANCE_B, {
        overall: emptyReportResult({ coverage: { totalActivitiesInScope: 1, trustedActivities: 0, ambiguousActivities: 1, extraActivities: 0 } }, INSTANCE_B),
      })),
    });

    render(<CompareReportsModal onClose={() => {}} />);

    expect(await screen.findByText("5 trusted · 0 ambiguous · 0 unplanned")).toBeInTheDocument();
    expect(await screen.findByText("0 trusted · 1 ambiguous · 0 unplanned")).toBeInTheDocument();
  });

  it("shows real structured quality-workout comparison when both sides are Range reports with evidence", async () => {
    window.history.replaceState(null, "", "/?compareAKind=range&compareAFrom=2026-08-01&compareATo=2026-08-31&compareBKind=range&compareBFrom=2026-07-01&compareBTo=2026-07-31");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([])),
      "GET /api/v1/reports/range": (req: { url: URL }) => {
        const from = req.url.searchParams.get("from");
        const to = req.url.searchParams.get("to");
        const withEvidence = from === "2026-08-01";
        return json(rangeReport(from!, to!, withEvidence ? {
          qualityEvidence: {
            totalWorkouts: 1, workoutsWithEvidence: 1, segments: { totalWorkSegments: 4, alignedWorkSegments: 4 },
            byKind: { repetition: { total: 1, withEvidence: 1 } }, workouts: [],
          },
        } : {
          qualityEvidence: {
            totalWorkouts: 1, workoutsWithEvidence: 0, segments: { totalWorkSegments: 4, alignedWorkSegments: 2 },
            byKind: { repetition: { total: 1, withEvidence: 0 } }, workouts: [],
          },
        }));
      },
    });

    render(<CompareReportsModal onClose={() => {}} />);

    expect(await screen.findByText("repetition")).toBeInTheDocument();
    expect(await screen.findByText("A: 1/1")).toBeInTheDocument();
    expect(await screen.findByText("B: 0/1")).toBeInTheDocument();
  });

  it("drills down: opening Report A's full report reuses the EXISTING PlanReportModal, then returns without losing either definition", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=plan&compareBInstance=20");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block"), planInstance(INSTANCE_B, "Base Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A)),
      [PLAN_B_ROUTE]: json(planReport("Base Block", INSTANCE_B)),
    });

    render(<CompareReportsModal onClose={() => {}} />);
    await screen.findAllByText("Marathon Block");

    const openButtons = await screen.findAllByText("Open full report");
    fireEvent.click(openButtons[0]);
    expect(await screen.findByText("Plan report")).toBeInTheDocument();

    // Two "Close" buttons are on screen now (this modal's own + the nested
    // PlanReportModal's) — close the nested one specifically, by scoping to
    // its own dialog.
    const planDialog = screen.getByRole("dialog", { name: "Plan report" });
    fireEvent.click(within(planDialog).getByLabelText("Close"));
    // Both original definitions are still on screen (never reset by the
    // child modal's own open/close cycle).
    expect((await screen.findAllByText("Marathon Block")).length).toBeGreaterThanOrEqual(2);
    expect((await screen.findAllByText("Base Block")).length).toBeGreaterThanOrEqual(2);
  });

  it("never renders a synthetic quality/readiness/performance score", async () => {
    window.history.replaceState(null, "", "/?compareAKind=plan&compareAInstance=10&compareBKind=plan&compareBInstance=20");
    installFetch({
      [INSTANCES_ROUTE]: json(paginated([planInstance(INSTANCE_A, "Marathon Block"), planInstance(INSTANCE_B, "Base Block")])),
      [PLAN_A_ROUTE]: json(planReport("Marathon Block", INSTANCE_A)),
      [PLAN_B_ROUTE]: json(planReport("Base Block", INSTANCE_B)),
    });

    render(<CompareReportsModal onClose={() => {}} />);
    await screen.findAllByText("Marathon Block");

    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/readiness/i)).not.toBeInTheDocument();
  });
});
