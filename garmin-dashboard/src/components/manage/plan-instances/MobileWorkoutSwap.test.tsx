/**
 * MobileWorkoutSwap.test.tsx (HRA-301)
 * Explicit mobile day-swap flow — mounted standalone, same pattern
 * MobileWorkoutEditor.test.tsx already uses.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MobileWorkoutSwap } from "./MobileWorkoutSwap";
import { apiDaysToSections } from "./planInstanceEditor.mappers";
import { installFetch, json, problem } from "@/test/api-stub";
import { planInstanceDay } from "@/test/fixtures";
import type { PlanInstanceDay } from "@/types/api";

const INSTANCE_ID = 10;

function buildSections(days: Partial<PlanInstanceDay>[]) {
  return apiDaysToSections(days.map(d => planInstanceDay(d)));
}

const baseFixture = () => buildSections([
  { id: 100, date: "2026-09-15", day: 1, week_number: 1, workout_type: "run", segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 330, raw: "5km @ RG" }]) },
  { id: 101, date: "2026-09-16", day: 2, week_number: 1, workout_type: "rest", segments: "[]" },
  { id: 102, date: "2026-09-01", day: 3, week_number: 1, workout_type: "run", segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 3000, raw: "3km" }, resolved_pace_sec_per_km: 300, raw: "3km @ MP" }]) },
  { id: 103, date: "2026-09-22", day: 1, week_number: 2, workout_type: "run", segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" }, resolved_pace_sec_per_km: 360, raw: "10km @ 6:00/km" }]) },
]);

function renderSwap(overrides: Partial<Parameters<typeof MobileWorkoutSwap>[0]> = {}) {
  const sections = baseFixture();
  const source = sections[0].weeks[0].days[0];
  const onClose = vi.fn();
  const onSwapped = vi.fn();
  render(
    <MobileWorkoutSwap
      source={source}
      sections={sections}
      instanceId={INSTANCE_ID}
      raceDate={null}
      hasActivity={() => false}
      onClose={onClose}
      onSwapped={onSwapped}
      {...overrides}
    />,
  );
  return { sections, source, onClose, onSwapped };
}

describe("MobileWorkoutSwap", () => {
  it("renders a target list spanning both weeks, blocking the source day itself, a past day, and offering a rest day and a cross-week day", () => {
    installFetch({});
    renderSwap();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /This is the workout you're swapping\./ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Past or completed days can't be swapped\./ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /16 Sep 2026 — REST/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /22 Sep 2026 — 10km @ 6:00\/km/ })).toBeEnabled();
  });

  it("blocks race day as a target", () => {
    installFetch({});
    renderSwap({ raceDate: "2026-09-22" });
    expect(screen.getByRole("button", { name: /Race day can't be swapped\./ })).toBeDisabled();
  });

  it("blocks a day with a matched recorded activity, even though it's in the future", () => {
    installFetch({});
    renderSwap({ hasActivity: date => date === "2026-09-22" });
    expect(screen.getByRole("button", { name: /22 Sep 2026 — 10km @ 6:00\/km.*Past or completed days can't be swapped\./ })).toBeDisabled();
  });

  it("selecting a valid target opens a confirmation sheet showing both days before/after; Cancel returns to the target list unchanged", () => {
    installFetch({});
    renderSwap();
    fireEvent.click(screen.getByRole("button", { name: /16 Sep 2026 — REST/ }));
    expect(screen.getByText("Confirm swap")).toBeInTheDocument();
    expect(screen.getByText(/15 Sep 2026 \(5km @ 5:30\/km\) ↔ .*16 Sep 2026 \(REST\)/)).toBeInTheDocument();

    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByText("Confirm swap")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /16 Sep 2026 — REST/ })).toBeInTheDocument();
  });

  it("confirming persists both days through one PATCH each, reports both persisted results, and shows an accessible success message with Undo", async () => {
    const updatedSource = planInstanceDay({ id: 100, date: "2026-09-15", day: 1, workout_type: "rest", segments: "[]", customized_at: "2026-09-10T00:00:00Z" });
    const updatedTarget = planInstanceDay({ id: 101, date: "2026-09-16", day: 2, workout_type: "run", segments: "[]", customized_at: "2026-09-10T00:00:00Z" });
    installFetch({
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/100`]: (req: { body: unknown }) => {
        expect(req.body).toEqual({ dsl: "D1: REST", scheduled_time: null });
        return json(updatedSource);
      },
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/101`]: (req: { body: unknown }) => {
        expect(req.body).toEqual({ dsl: "D2: 5km @ 5:30/km", scheduled_time: null });
        return json(updatedTarget);
      },
    });
    const { onSwapped } = renderSwap();
    fireEvent.click(screen.getByRole("button", { name: /16 Sep 2026 — REST/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Swap/ }));

    await waitFor(() => expect(onSwapped).toHaveBeenCalledWith(updatedSource, updatedTarget));
    expect(await screen.findByText("The two workouts have been swapped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("on a persistence failure, shows the error and never reports a false-swapped state", async () => {
    installFetch({
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/100`]: () => problem(422, "dsl must not be blank."),
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/101`]: () => json(planInstanceDay({ id: 101 })),
    });
    const { onSwapped } = renderSwap();
    fireEvent.click(screen.getByRole("button", { name: /16 Sep 2026 — REST/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Swap/ }));

    expect(await screen.findByText("dsl must not be blank.")).toBeInTheDocument();
    expect(onSwapped).not.toHaveBeenCalled();
    expect(screen.getByText("Confirm swap")).toBeInTheDocument();
  });

  it("Undo re-issues the inverse swap and closes", async () => {
    const updatedSource = planInstanceDay({ id: 100, date: "2026-09-15", day: 1, workout_type: "rest", segments: "[]" });
    const updatedTarget = planInstanceDay({ id: 101, date: "2026-09-16", day: 2, workout_type: "run", segments: "[]" });
    const undoneSource = planInstanceDay({ id: 100, date: "2026-09-15", day: 1, workout_type: "run" });
    const undoneTarget = planInstanceDay({ id: 101, date: "2026-09-16", day: 2, workout_type: "rest", segments: "[]" });
    installFetch({
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/100`]: (req: { body: unknown }) => {
        const body = req.body as { dsl: string };
        return json(body.dsl === "D1: REST" ? updatedSource : undoneSource);
      },
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/101`]: (req: { body: unknown }) => {
        const body = req.body as { dsl: string };
        return json(body.dsl === "D2: REST" ? undoneTarget : updatedTarget);
      },
    });
    const { onClose, onSwapped } = renderSwap();
    fireEvent.click(screen.getByRole("button", { name: /16 Sep 2026 — REST/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Swap/ }));
    await screen.findByText("The two workouts have been swapped.");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSwapped).toHaveBeenLastCalledWith(undoneSource, undoneTarget);
  });

  it("Cancel closes without persisting anything", () => {
    const patch = installFetch({});
    const { onClose } = renderSwap();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
