/**
 * AgendaTab.test.tsx (HRA-248, always-visible calendar HRA-263)
 * Component tests for "Your agenda": loading/error, the no-active-plan
 * banner (exact copy + secondary action, no longer a full-page takeover), a
 * workout day, a REST day, and the calendar rendering unconditionally — the
 * same underlying PlanInstanceCalendar Manage → Plans' own Agenda view uses,
 * just anchored on today.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgendaTab } from "./AgendaTab";
import { installFetch, paginated, problem, type Routes } from "@/test/api-stub";
import { activity, planInstance, planInstanceDay } from "@/test/fixtures";
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
  it("renders the empty-state copy, a working 'View race plans' action, and the calendar itself (HRA-263)", async () => {
    installFetch(activeRoutes({ "GET /api/v1/activities": paginated([]) }));
    const onNavigateToPlans = vi.fn();
    const { container } = render(<AgendaTab onNavigateToPlans={onNavigateToPlans} />);

    expect(await screen.findByText("There is no active plan today.")).toBeInTheDocument();
    expect(screen.getByText("Run free. Or rest. Be happy.")).toBeInTheDocument();
    // AC1: the calendar grid renders even though api.planInstances.active(date) is null.
    await waitFor(() => expect(container.querySelector(".hra-agenda-calendar")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "View race plans" }));
    expect(onNavigateToPlans).toHaveBeenCalledTimes(1);
  });

  it("still shows today's recorded activity on the calendar when there is no active plan (AC4, HRA-262 merge)", async () => {
    installFetch(activeRoutes({
      "GET /api/v1/activities": paginated([activity({ date_only: TODAY, sport: "running", distance_m: 5000 })]),
    }));
    render(<AgendaTab onNavigateToPlans={() => {}} />);

    // A runner with no active plan but a real activity today: the "nothing at
    // all today" copy must NOT show, since today isn't actually empty.
    await screen.findByText("There is no active plan today.");
    expect(screen.queryByText("Run free. Or rest. Be happy.")).not.toBeInTheDocument();
    expect(await screen.findByText("Recorded activity")).toBeInTheDocument();
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
