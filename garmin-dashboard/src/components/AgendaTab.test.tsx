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
import { installFetch, json, paginated, problem, type Routes } from "@/test/api-stub";
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

// HRA-300: same phone-width stub PlanInstanceCalendar.test.tsx's own
// "phone-tier day ribbon" tests use — the mobile editor only opens under
// this same useIsPhone() branch.
function stubPhoneViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

const TODAY = isoToday();

function activeRoutes(overrides: Routes = {}): Routes {
  return { [`GET /api/v1/plan-instances/active`]: problem(404, `No active plan for ${TODAY}`), ...overrides };
}

describe("AgendaTab — loading/error", () => {
  it("shows an error banner, never the empty-state copy, on a genuine fetch failure", async () => {
    installFetch(activeRoutes({ "GET /api/v1/plan-instances/active": problem(500, "boom") }));
    render(<AgendaTab onNavigateToPlans={() => {}} onNavigateToActivity={() => {}} />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(screen.queryByText("There is no active plan today.")).not.toBeInTheDocument();
  });
});

describe("AgendaTab — no active plan", () => {
  it("renders the empty-state copy, a working 'View race plans' action, and the calendar itself (HRA-263)", async () => {
    installFetch(activeRoutes({ "GET /api/v1/activities": paginated([]) }));
    const onNavigateToPlans = vi.fn();
    const { container } = render(<AgendaTab onNavigateToPlans={onNavigateToPlans} onNavigateToActivity={() => {}} />);

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
    render(<AgendaTab onNavigateToPlans={() => {}} onNavigateToActivity={() => {}} />);

    // A runner with no active plan but a real activity today: the "nothing at
    // all today" copy must NOT show, since today isn't actually empty.
    await screen.findByText("There is no active plan today.");
    expect(screen.queryByText("Run free. Or rest. Be happy.")).not.toBeInTheDocument();
    // AgendaTab's calendar defaults to Week view — HRA-264's row card shows
    // an actual-only day's own activity type here ("running"), not Month's
    // "Recorded activity" compact-row text (see PlanInstanceCalendar.test.tsx).
    expect(await screen.findByText("running")).toBeInTheDocument();
  });
});

describe("AgendaTab — an active plan covers today", () => {
  it("renders today's workout via the same Agenda calendar Manage → Plans uses", async () => {
    const instance = {
      ...planInstance({ name: "Boston Build" }),
      days: [planInstanceDay({ date: TODAY, day: 1, workout_type: "run" })],
    };
    installFetch(activeRoutes({ "GET /api/v1/plan-instances/active": instance }));
    const { container } = render(<AgendaTab onNavigateToPlans={() => {}} onNavigateToActivity={() => {}} />);

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
    const { container } = render(<AgendaTab onNavigateToPlans={() => {}} onNavigateToActivity={() => {}} />);

    await waitFor(() => {
      const summary = container.querySelector(".hra-agenda-summary");
      expect(summary?.textContent).toMatch(/1\s*rest/);
    });
    expect(screen.queryByText("There is no active plan today.")).not.toBeInTheDocument();
  });

  // HRA-300: Agenda's own workout-row entry point for the mobile full-screen
  // DSL editor — the same PlanInstanceCalendar component Manage → Plans uses
  // (AC2's "same editor" requirement), now wired with the active instance's
  // own id so a Save persists and this tab refreshes from the same active-
  // plan fetch every other Agenda state already reads from.
  it("opens the mobile full-screen editor for today's workout, and refetches the active plan after a successful save", async () => {
    stubPhoneViewport();
    const instance = {
      ...planInstance({ name: "Boston Build" }),
      days: [planInstanceDay({ date: TODAY, day: 1, workout_type: "run" })],
    };
    let activeCalls = 0;
    installFetch({
      "GET /api/v1/plan-instances/active": () => { activeCalls++; return json(instance); },
      "GET /api/v1/activities": paginated([]),
      "POST /api/v1/plan-instances/10/days/100/validate": json({ needs_review: true, warnings: [] }),
    });
    render(<AgendaTab onNavigateToPlans={() => {}} onNavigateToActivity={() => {}} />);

    await screen.findByText(/Boston Build/);
    fireEvent.click(await screen.findByText(/5km/));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Workout plan text (DSL)")).toBeInTheDocument();
    expect(activeCalls).toBe(1);
  });
});
