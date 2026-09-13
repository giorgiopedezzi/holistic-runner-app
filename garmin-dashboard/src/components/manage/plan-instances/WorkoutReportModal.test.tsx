/**
 * WorkoutReportModal.test.tsx (HRA-336)
 * Behavior net for the single-workout/race report modal — mounted standalone
 * against a stubbed GET .../reports/workouts/:workoutId response, same
 * installFetch/api-stub pattern as MobileWorkoutEditor.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkoutReportModal } from "./WorkoutReportModal";
import { installFetch, json, problem } from "@/test/api-stub";
import type { WorkoutReport } from "@/types/api";

const INSTANCE_ID = 10;
const WORKOUT_ID = "workout-abc";

function report(overrides: Partial<WorkoutReport> = {}): WorkoutReport {
  return {
    provenance: {
      planInstanceId: INSTANCE_ID, planInstanceName: "Marathon Block", workoutId: WORKOUT_ID,
      originalRevision: 1, currentRevision: 1, scheduleTimezone: "Europe/Rome", hasOriginalBaseline: true,
      generatedAt: "2026-09-10T07:00:00Z", asOf: "2026-09-10T07:00:00Z",
    },
    identity: { sectionName: "Base", weekNumber: 1, day: 1, workoutType: "run", originalDate: "2026-09-10", currentDate: "2026-09-10" },
    lineage: "unchanged",
    originalEqualsCurrent: true,
    state: "missed",
    planned: { original: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 }, current: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 } },
    actual: { metrics: null, evidence: [], hasAmbiguousEvidence: false },
    race: { isRace: false },
    hr: null,
    stamina: null,
    pauses: null,
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
    ...overrides,
  };
}

const ROUTE = `GET /api/v1/plan-instances/${INSTANCE_ID}/reports/workouts/${WORKOUT_ID}`;

describe("WorkoutReportModal", () => {
  it("renders the unchanged-plan case as one Planned dataset, with an empty Actual state", async () => {
    installFetch({ [ROUTE]: json(report()) });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("Original plan unchanged")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("No recorded activity — marked missed.")).toBeInTheDocument();
    expect(screen.queryByText("Race")).not.toBeInTheDocument();
  });

  it("renders separate Original/Current datasets when they differ", async () => {
    installFetch({
      [ROUTE]: json(report({
        lineage: "modified", originalEqualsCurrent: false,
        planned: { original: { distanceM: 8000, approximate: false, durationSec: 2400, paceSecPerKm: 300 }, current: { distanceM: 10000, approximate: false, durationSec: 3000, paceSecPerKm: 300 } },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Original plan unchanged")).not.toBeInTheDocument();
  });

  it("renders accepted actual metrics when present", async () => {
    installFetch({
      [ROUTE]: json(report({
        state: "completed",
        actual: { metrics: { distanceM: 10100, approximate: false, durationSec: 3050, paceSecPerKm: 302 }, evidence: [{ activityId: 1, status: "automatic", elapsedSec: 3050, activeSec: 3000, pausedSec: 50 }], hasAmbiguousEvidence: false },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("10.10 km")).toBeInTheDocument();
  });

  it("flags ambiguous evidence without folding it into trusted actual metrics", async () => {
    installFetch({ [ROUTE]: json(report({ actual: { metrics: null, evidence: [], hasAmbiguousEvidence: true } })) });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText(/unresolved activity link exists/)).toBeInTheDocument();
  });

  it("renders the race section with elapsed-time actual comparison when isRace is true", async () => {
    installFetch({
      [ROUTE]: json(report({
        race: { isRace: true, targetDistanceM: 42195, targetDurationSec: 12600, targetPaceSecPerKm: 298.7, actualElapsedSec: 12700, actualMovingSec: 12500, actualSource: "activity" },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("Race")).toBeInTheDocument();
    expect(screen.getByText("Source: linked activity")).toBeInTheDocument();
  });

  it("renders an unresolved race with no fabricated zero result", async () => {
    installFetch({
      [ROUTE]: json(report({ race: { isRace: true, targetDistanceM: 42195, targetDurationSec: 12600, targetPaceSecPerKm: 298.7, actualSource: "none" } })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText(/No accepted result yet/)).toBeInTheDocument();
  });

  it("renders HR average/max and coverage note when partial (HRA-337)", async () => {
    installFetch({
      [ROUTE]: json(report({
        hr: { avgHr: 152.4, maxHr: 178, coverage: { withHr: 1, total: 2 } },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("152 bpm")).toBeInTheDocument();
    expect(screen.getByText("178 bpm")).toBeInTheDocument();
    expect(screen.getByText("HR available for 1 of 2 accepted activities.")).toBeInTheDocument();
  });

  it("renders stamina start/finish/depletion/minimum, never assuming a 100% start (HRA-337)", async () => {
    installFetch({
      [ROUTE]: json(report({
        stamina: { firstValid: 82, finish: 48, depletionPoints: 34, minimum: 40, coverage: { withStamina: 4, total: 5 } },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("82")).toBeInTheDocument();
    expect(screen.getByText("48")).toBeInTheDocument();
    expect(screen.getByText("34 pts")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("renders pause count/longest/total and a direct-inspection dialog — no animation involved (HRA-337 AC5/AC6)", async () => {
    installFetch({
      [ROUTE]: json(report({
        pauses: {
          pauseCount: 1, longestPauseSec: 45, totalPausedFromPausesSec: 45, hasTrackData: true,
          details: [{
            index: 1, elapsedSec: 601, distanceM: 200, durationSec: 45, hrBefore: 158, hrAfter: 130,
            hrRecoveryDelta: 28, staminaBefore: 68, staminaAfter: 68, provenance: "recorded",
          }],
        },
      })),
    });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: "Pauses (1)" })).toBeInTheDocument();
    expect(screen.getAllByText("0:45")).toHaveLength(2); // longest + total, both 45s
  });

  it("renders an error banner when the fetch fails", async () => {
    installFetch({ [ROUTE]: problem(404, "No workout found.") });
    render(<WorkoutReportModal instanceId={INSTANCE_ID} workoutId={WORKOUT_ID} onClose={() => {}} />);

    expect(await screen.findByText("No workout found.")).toBeInTheDocument();
  });
});
