/**
 * AgendaTab.test.tsx (HRA-248)
 * Component tests for "Your agenda": loading/error, the no-active-plan
 * empty state (exact copy + secondary action), a workout day, and a REST
 * day — the same underlying PlanInstanceCalendar Manage → Plans' own Agenda
 * view uses, just anchored on today.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgendaTab } from "./AgendaTab";
import { installFetch, problem, type Routes } from "@/test/api-stub";
import { planInstance, planInstanceDay } from "@/test/fixtures";
import { isoToday } from "@/utils/date";

// Radix Popover (CategoryCriteriaPopover, always rendered in the calendar's
// own toolbar) calls these during pointer interaction — jsdom implements
// neither (same stub PlanInstancesSection.test.tsx already establishes for
// this same underlying calendar).
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

afterEach(() => vi.unstubAllGlobals());

const TODAY = isoToday();

function activeRoutes(overrides: Routes = {}): Routes {
  return { [`GET /api/v1/plan-instances/active`]: problem(404, `No active plan for ${TODAY}`), ...overrides };
}

describe("AgendaTab — loading/error", () => {
  it("shows an error banner, never the empty-state copy, on a genuine fetch failure", async () => {
    installFetch(activeRoutes({ "GET /api/v1/plan-instances/active": problem(500, "boom") }));
    render(<AgendaTab onNavigateToPlans={() => {}} />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("There is no active plan today.")).not.toBeInTheDocument();
  });
});

describe("AgendaTab — no active plan", () => {
  it("renders the exact empty-state copy and a working 'View race plans' action", async () => {
    installFetch(activeRoutes());
    const onNavigateToPlans = vi.fn();
    render(<AgendaTab onNavigateToPlans={onNavigateToPlans} />);

    expect(await screen.findByText("There is no active plan today.")).toBeInTheDocument();
    expect(screen.getByText("Run free. Or rest. Be happy.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View race plans" }));
    expect(onNavigateToPlans).toHaveBeenCalledTimes(1);
  });
});

describe("AgendaTab — an active plan covers today", () => {
  it("renders today's workout via the same Agenda calendar Manage → Plans uses", async () => {
    const instance = {
      ...planInstance({ name: "Boston Build" }),
      days: [planInstanceDay({ date: TODAY, day: 1, workout_type: "run" })],
    };
    installFetch(activeRoutes({ "GET /api/v1/plan-instances/active": instance }));
    const { container } = render(<AgendaTab onNavigateToPlans={() => {}} />);

    expect(await screen.findByText(/Boston Build/)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".hra-agenda-calendar")).toBeInTheDocument());
    await waitFor(() => {
      const summary = container.querySelector(".hra-agenda-summary");
      expect(summary?.textContent).toMatch(/1\s*workouts/);
      expect(summary?.textContent).toMatch(/1\s*runs/);
    });
  });

  it("renders today's REST day, not the empty state", async () => {
    const instance = {
      ...planInstance({ name: "Boston Build" }),
      days: [planInstanceDay({
        date: TODAY, day: 1, workout_type: "rest",
        segments: JSON.stringify([{ type: "rest_block", target: { kind: "unknown", raw: "" }, rest_type: "jog", raw: "REST" }]),
      })],
    };
    installFetch(activeRoutes({ "GET /api/v1/plan-instances/active": instance }));
    const { container } = render(<AgendaTab onNavigateToPlans={() => {}} />);

    await waitFor(() => {
      const summary = container.querySelector(".hra-agenda-summary");
      expect(summary?.textContent).toMatch(/1\s*rest/);
    });
    expect(screen.queryByText("There is no active plan today.")).not.toBeInTheDocument();
  });
});
