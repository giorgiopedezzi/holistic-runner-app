/**
 * PlanInstanceCalendar.test.tsx (HRA-262)
 * Actual-workout-data matching, exercised directly against the component
 * with hand-built SectionView fixtures — bypasses PlanInstancesSection/
 * AgendaTab's own surrounding data fetches (templates, active-plan lookup)
 * entirely, since the behaviour under test lives inside PlanInstanceCalendar
 * itself and applies identically at both of its call sites.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PlanInstanceCalendar } from "./PlanInstanceCalendar";
import { installFetch, paginated } from "@/test/api-stub";
import { activity } from "@/test/fixtures";
import type { SectionView } from "@/domain/runplan-aggregate";

// Radix Popover (CategoryCriteriaPopover, always rendered in the calendar's
// own toolbar) calls these during pointer interaction — jsdom implements
// neither (same stub PlanInstancesSection.test.tsx/AgendaTab.test.tsx
// already establish for this same underlying calendar).
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  // Forces Month view (useUrlState's own default is "week") — Month's day
  // cells are the simplest to assert against.
  window.history.replaceState({}, "", "/?planCalendarView=month");
});

afterEach(() => vi.unstubAllGlobals());

const ZERO_TOTALS = { totalDays: 0, activeDays: 0, runningDays: 0, restDays: 0, otherDays: 0, distance: { meters: 0, approximate: false } };

// A day with no plan at all (2026-09-02) sits between two resolved plan
// days, deliberately not present in `days` below — the "actual but no plan"
// gap this Story's own event-model extension exists to fill.
function sections(): SectionView[] {
  return [{
    name: "Base", raw_dsl: "", totals: ZERO_TOTALS,
    weeks: [{
      number: 1, raw_dsl: "", totals: ZERO_TOTALS,
      days: [
        {
          day: 1, workout_type: "run", dsl: "D1: 5km @ RG", needs_review: false, warnings: [],
          distance: { meters: 5000, approximate: false }, date: "2026-09-01",
          metrics: { totalDistanceM: 5000, minSpeedKmh: 10, maxSpeedKmh: 12, totalDurationSec: 1800 },
          trainingLoadCategory: "easy_recovery",
        },
        {
          day: 3, workout_type: "rest", dsl: "D3: REST", needs_review: false, warnings: [],
          distance: { meters: 0, approximate: false }, date: "2026-09-03",
          metrics: { totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 },
          trainingLoadCategory: "rest",
        },
      ],
    }],
  }];
}

const noop = () => {};

describe("PlanInstanceCalendar — actual-workout indicators (HRA-262)", () => {
  it("shows an indicator on a date with a recorded activity but no plan day", async () => {
    installFetch({ "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-02", distance_m: 3000 })]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("Recorded activity")).toBeInTheDocument());
    expect(screen.getByTitle("Recorded activity: 3.0 km")).toBeInTheDocument();
  });

  it("shows indicators for both the plan day and the recorded activity on the same date", async () => {
    installFetch({ "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-01", distance_m: 8000 })]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    // The plan day's own card (D1's DSL text) still renders unmodified.
    await waitFor(() => expect(screen.getByText("5km @ RG")).toBeInTheDocument());
    expect(screen.getByTitle("Recorded activity: 8.0 km")).toBeInTheDocument();
    // Not the plan-free compact row — this date has a plan.
    expect(screen.queryByText("Recorded activity")).not.toBeInTheDocument();
  });

  it("shows neither indicator on a date with no plan and no recorded activity", async () => {
    installFetch({ "GET /api/v1/activities": paginated([]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("Rest")).toBeInTheDocument());
    expect(screen.queryByText("Recorded activity")).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Recorded activity/)).not.toBeInTheDocument();
  });

  it("also shows the actual-only indicator in Week view (same DayCellEvent renderer)", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    installFetch({ "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-02", distance_m: 3000 })]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("Recorded activity")).toBeInTheDocument());
    window.history.replaceState({}, "", "/?planCalendarView=month");
  });
});
