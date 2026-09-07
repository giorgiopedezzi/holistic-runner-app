/**
 * PlanInstanceCalendar.test.tsx (HRA-262)
 * Actual-workout-data matching, exercised directly against the component
 * with hand-built SectionView fixtures — bypasses PlanInstancesSection/
 * AgendaTab's own surrounding data fetches (templates, active-plan lookup)
 * entirely, since the behaviour under test lives inside PlanInstanceCalendar
 * itself and applies identically at both of its call sites.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
          trainingLoadCategory: "easy_recovery", id: 501,
        },
        {
          day: 3, workout_type: "rest", dsl: "D3: REST", needs_review: false, warnings: [],
          distance: { meters: 0, approximate: false }, date: "2026-09-03",
          metrics: { totalDistanceM: 0, minSpeedKmh: null, maxSpeedKmh: null, totalDurationSec: 0 },
          trainingLoadCategory: "rest", id: 503,
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

  // HRA-264: Week view now renders its own row-based card (WeekRowCard),
  // not Month's compact "Recorded activity" row — an actual-only day's Row 1
  // shows the activity's own type instead (this Story's proposed default for
  // its own flagged Risk: "what row 1 shows with no plan at all").
  it("shows the activity's own type as Row 1 for an actual-only day in Week view (HRA-264)", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    installFetch({ "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-02", distance_m: 3000 })]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("running")).toBeInTheDocument());
    expect(screen.queryByText("Recorded activity")).not.toBeInTheDocument();
    window.history.replaceState({}, "", "/?planCalendarView=month");
  });
});

// HRA-264: Week view's row-based day card — Month view is untouched (still
// covered by every test above, all of which force month via the file's own
// beforeAll). Each test here switches to Week view explicitly and restores
// month afterwards, same pattern the last test above already established.
describe("PlanInstanceCalendar — Week view row card (HRA-264)", () => {
  afterEach(() => window.history.replaceState({}, "", "/?planCalendarView=month"));

  it("a day with a plan and no actual: category label + DSL text + plan icon, no runner glyph or metrics row", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    installFetch({ "GET /api/v1/activities": paginated([]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("Easy/Recovery")).toBeInTheDocument());
    expect(screen.getByText("5km @ RG")).toBeInTheDocument();
    expect(screen.queryByTitle(/Recorded activity/)).not.toBeInTheDocument();
  });

  it("a day with an actual and no plan: activity's own type + distance/pace/HR, no DSL or plan icon", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    installFetch({
      "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-02", distance_m: 3000, avg_pace_minkm: 5, avg_hr: 150 })]),
    });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("running")).toBeInTheDocument());
    expect(screen.getByText("3.0 km · 5:00 min/km · 150 bpm")).toBeInTheDocument();
  });

  it("a day with both a plan and an actual: plan icon, runner glyph, DSL, and metrics row all present", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    installFetch({
      "GET /api/v1/activities": paginated([activity({ date_only: "2026-09-01", distance_m: 5200, avg_pace_minkm: 5.1, avg_hr: 148 })]),
    });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("5km @ RG")).toBeInTheDocument());
    expect(screen.getByTitle("Recorded activity: 5.2 km")).toBeInTheDocument();
    expect(screen.getByText("5.2 km · 5:06 min/km · 148 bpm")).toBeInTheDocument();
  });

  it("a day's own note takes Row 1 precedence over its training-load category label", async () => {
    window.history.replaceState({}, "", "/?planCalendarView=week");
    const withNote = sections();
    withNote[0].weeks[0].days[0].notes = "Feeling great today";
    installFetch({ "GET /api/v1/activities": paginated([]) });
    render(<PlanInstanceCalendar sections={withNote} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("Feeling great today")).toBeInTheDocument());
    expect(screen.queryByText("Easy/Recovery")).not.toBeInTheDocument();
  });
});

// HRA-265: click-to-open a non-empty agenda day — Month view (this file's
// own beforeAll forces it), same as every describe block above except the
// dedicated Week-view one.
describe("PlanInstanceCalendar — click-to-open (HRA-265)", () => {
  it("clicking a planned-only day opens the edit modal pre-filled with its DSL, and typing calls onDayEdit", async () => {
    installFetch({ "GET /api/v1/activities": paginated([]) });
    const onDayEdit = vi.fn();
    render(
      <PlanInstanceCalendar
        sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop} onDayEdit={onDayEdit}
      />,
    );

    await waitFor(() => expect(screen.getByText("5km @ RG")).toBeInTheDocument());
    fireEvent.click(screen.getByText("5km @ RG"));

    const textarea = await screen.findByDisplayValue("5km @ RG");
    fireEvent.change(textarea, { target: { value: "10km @ RG" } });
    expect(onDayEdit).toHaveBeenCalledWith(501, { dsl: "D1: 10km @ RG" });

    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("clicking a planned-only day on the read-only Agenda tab opens a read-only view, with no editable fields", async () => {
    installFetch({ "GET /api/v1/activities": paginated([]) });
    render(<PlanInstanceCalendar sections={sections()} readOnlyDays onScheduledTimeEdit={noop} onDaySwap={noop} />);

    await waitFor(() => expect(screen.getByText("5km @ RG")).toBeInTheDocument());
    fireEvent.click(screen.getByText("5km @ RG"));

    await waitFor(() => expect(screen.getByLabelText("Close")).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("clicking a day with a recorded activity (no plan) calls onNavigateToActivity with that activity's id", async () => {
    installFetch({ "GET /api/v1/activities": paginated([activity({ id: 42, date_only: "2026-09-02", distance_m: 3000 })]) });
    const onNavigateToActivity = vi.fn();
    render(
      <PlanInstanceCalendar
        sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop}
        onNavigateToActivity={onNavigateToActivity}
      />,
    );

    await waitFor(() => expect(screen.getByText("Recorded activity")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Recorded activity"));

    expect(onNavigateToActivity).toHaveBeenCalledWith(42);
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("clicking a day with both a plan and a recorded activity navigates to the activity, not the edit modal", async () => {
    installFetch({ "GET /api/v1/activities": paginated([activity({ id: 7, date_only: "2026-09-01", distance_m: 8000 })]) });
    const onDayEdit = vi.fn();
    const onNavigateToActivity = vi.fn();
    render(
      <PlanInstanceCalendar
        sections={sections()} readOnlyDays={false} onScheduledTimeEdit={noop} onDaySwap={noop}
        onDayEdit={onDayEdit} onNavigateToActivity={onNavigateToActivity}
      />,
    );

    await waitFor(() => expect(screen.getByText("5km @ RG")).toBeInTheDocument());
    fireEvent.click(screen.getByText("5km @ RG"));

    expect(onNavigateToActivity).toHaveBeenCalledWith(7);
    expect(onDayEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });
});
