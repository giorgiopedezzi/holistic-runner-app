/**
 * OverviewTab.test.tsx  (HRA-67)
 * Behaviour-level characterization: success (totals + running stats), the
 * range-empty state, and the error state. Asserts only on rendered text —
 * never on internal state or chart geometry.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { OverviewTab } from "./OverviewTab";
import { installFetch, json, problem, paginated, type StubRequest } from "@/test/api-stub";
import { sportSummary, dateRange, settings, activity } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";
import { ALL_SENTINEL } from "@/utils/date";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  window.history.replaceState({}, "", "/");
});

// OverviewTab now takes the full live state (setters included) — it renders
// its own DateRangeBar — not just from/to strings. Tests here never click
// the bar, so the setters are no-ops.
function fakeRange(from: string, to: string): DateRangeState {
  return { from, to, setFrom: () => {}, setTo: () => {}, setPreset: () => {} };
}
function fakeCompareRange(from: string, to: string): CompareRangeState {
  return { from, to, setFrom: () => {}, setTo: () => {}, enabled: true, setEnabled: () => {} };
}

// HRA-307: deltas (comparison figures) only render in "overlap" view mode
// (OverviewTab's own showDiff gate, unchanged by this Story) — forces the
// `trendsView` URL param useUrlState reads on mount, same as picking
// "Overlay" in the UI.
function stubOverlapView() {
  window.history.replaceState({}, "", "?trendsView=overlap");
}

describe("OverviewTab", () => {
  it("renders totals and a running section on success", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/date-ranges": paginated([]),
    });
    render(<OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />);

    expect(await screen.findByText("Avg distance")).toBeInTheDocument();
  });

  it("shows the range-empty message when the range holds no activities", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/date-ranges": paginated([]),
    });
    render(<OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />);

    expect(await screen.findByText(/No activities in the selected range/i)).toBeInTheDocument();
  });

  // HRA-256: the useDateRange "All" preset's internal 2000-01-01 sentinel
  // must never render as a literal date anywhere on the tab (date picker,
  // empty-state message), and automatic comparison must not manufacture a
  // multi-decade "previous period" off it.
  it("selecting All never renders the 2000-01-01 sentinel and disables automatic comparison", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/date-ranges": paginated([]),
    });
    const disabledCompare: CompareRangeState = { from: "2026-08-10", to: "2026-08-10", setFrom: () => {}, setTo: () => {}, enabled: false, setEnabled: () => {} };
    render(<OverviewTab range={fakeRange(ALL_SENTINEL, "2026-08-14")} compareRange={disabledCompare} savedRanges={[]} />);

    await screen.findByText(/No activities in the selected range/i);
    expect(screen.queryByText(/2000/)).not.toBeInTheDocument();
    // Appears twice: the "from" date-picker trigger AND the empty-state message.
    expect(screen.getAllByText(/All available data/i).length).toBeGreaterThan(0);
  });

  it("surfaces the API error message on failure", async () => {
    installFetch({
      "GET /api/v1/summary": () => problem(500, "summary blew up"),
      "GET /api/v1/range": () => json(dateRange()),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/date-ranges": paginated([]),
    });
    render(<OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />);

    expect(await screen.findByText("summary blew up")).toBeInTheDocument();
  });

  // HRA-255: an empty compare period must never inherit or manufacture the
  // current period's KPI values. The /api/v1/activities stub is routed by
  // its `from` query param so the current and compare periods can return
  // different activity lists — the current period has one running activity,
  // the compare period has none.
  it("shows dashes, never manufactured zero/current values, when the compare period has no activities", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": (req: StubRequest) =>
        json(paginated(req.url.searchParams.get("from") === "2026-07-15" ? [activity()] : [])),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/date-ranges": paginated([]),
    });
    render(<OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />);

    await screen.findByText("Avg distance");

    // Activities: 0 is shown (not hidden, not inherited from the current
    // period's non-zero count).
    expect(await screen.findByText("0")).toBeInTheDocument();
    // Every derived compare-side KPI (avg pace, distance, avg distance,
    // avg HR, time, calories) renders as "—", never 0, 0.00 km, 0.0 h, or NaN.
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText("0.00 km")).not.toBeInTheDocument();
    expect(screen.queryByText("0.0 h")).not.toBeInTheDocument();
  });

  // HRA-307: one page-level mobile KPI summary replaces the chart-header
  // GraphKpiCard row + "Other key metrics" sidebar on phone.
  describe("mobile KPI summary", () => {
    it("shows every KPI once, with no duplicated chart-header card row", async () => {
      stubPhoneWidth(true);
      installFetch({
        "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/activities": paginated([]),
        "GET /api/v1/settings": settings(),
        "GET /api/v1/date-ranges": paginated([]),
      });
      const { container } = render(
        <OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={{ ...fakeCompareRange("2026-06-15", "2026-07-14"), enabled: false }} savedRanges={[]} />,
      );

      await screen.findByText("Avg distance");
      // The seven metrics from the Story's agreed priority — each present
      // exactly once (no chart-header duplicate of Distance/Activities/Avg pace).
      for (const label of ["Distance", "Activities", "Time", "Avg pace", "Avg HR", "Avg distance", "Calories"]) {
        expect(screen.getAllByText(label)).toHaveLength(1);
      }
      // No bordered mini-card chrome (GraphKpiCard's own class) anywhere —
      // the chart begins with its title/controls, not a second KPI row.
      expect(container.querySelectorAll(".hra-graph-kpi").length).toBe(0);
    });

    it("keeps heart-rate deltas neutral (no up/down color) while pace/distance deltas are directional", async () => {
      stubPhoneWidth(true);
      stubOverlapView();
      installFetch({
        "GET /api/v1/summary": paginated([sportSummary({ sport: "running", avg_hr: 160 })]),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/activities": (req: StubRequest) =>
          json(paginated(req.url.searchParams.get("from") === "2026-07-15"
            ? [activity({ avg_hr: 160 })]
            : [activity({ avg_hr: 140 })])),
        "GET /api/v1/settings": settings(),
        "GET /api/v1/date-ranges": paginated([]),
      });
      const { container } = render(
        <OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />,
      );

      await screen.findByText("Avg HR");
      const hrRow = screen.getByText("Avg HR").closest(".hra-fact-row-stat");
      expect(hrRow).not.toBeNull();
      expect(hrRow!.querySelector(".hra-stat-delta-up, .hra-stat-delta-down")).toBeNull();

      const distanceDelta = container.querySelector(".hra-fact-row-hero .hra-stat-delta");
      expect(distanceDelta).not.toBeNull();
      expect(distanceDelta!.className).toMatch(/hra-stat-delta-(up|down)/);
    });

    it("shows both current and previous activity counts when they differ, without a fabricated compare value", async () => {
      stubPhoneWidth(true);
      stubOverlapView();
      installFetch({
        "GET /api/v1/summary": paginated([sportSummary({ sport: "running", total_activities: 5 })]),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/activities": (req: StubRequest) =>
          json(paginated(req.url.searchParams.get("from") === "2026-07-15"
            ? [activity(), activity(), activity(), activity(), activity()]
            : [activity()])),
        "GET /api/v1/settings": settings(),
        "GET /api/v1/date-ranges": paginated([]),
      });
      render(
        <OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={fakeCompareRange("2026-06-15", "2026-07-14")} savedRanges={[]} />,
      );

      const activitiesRow = (await screen.findByText("Activities")).closest(".hra-fact-row-stat");
      expect(activitiesRow).not.toBeNull();
      // Current count (main value) ...
      expect(activitiesRow!.textContent).toContain("5");
      // ... and the previous period's own count, inside the delta text —
      // both stay visible, no implied like-for-like equivalence.
      expect(activitiesRow!.textContent).toContain("1");
    });

    it("omits a KPI entirely (no fabricated zero) when the metric is missing for the period", async () => {
      stubPhoneWidth(true);
      installFetch({
        "GET /api/v1/summary": paginated([sportSummary({ sport: "running", avg_hr: null as unknown as number })]),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/activities": paginated([]),
        "GET /api/v1/settings": settings(),
        "GET /api/v1/date-ranges": paginated([]),
      });
      render(
        <OverviewTab range={fakeRange("2026-07-15", "2026-08-14")} compareRange={{ ...fakeCompareRange("2026-06-15", "2026-07-14"), enabled: false }} savedRanges={[]} />,
      );

      await screen.findByText("Avg distance");
      expect(screen.queryByText("Avg HR")).not.toBeInTheDocument();
      expect(screen.queryByText("0 bpm")).not.toBeInTheDocument();
    });
  });
});

// HRA-308 — mobile comparison-settings & grouping disclosure. Same
// stubPhoneWidth pattern DateRangeBar.test.tsx (HRA-306) already uses for
// useIsPhone's matchMedia dependency; the default setup.ts stub reports
// "no match" (desktop), so every OverviewTab test above already exercises
// the desktop/unchanged code path.
function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// A short (9-day) current range keeps the default grouping at "single"
// (defaultGroupMode), and 2 current vs 1 compare activity both (a) keeps
// Week/Month disabled (well under min_trend_group_size=5 distinct weeks/
// months) and (b) makes the current/compare point counts differ, which is
// what surfaces the Match order/Match by time control. One dataset serves
// every test below.
const CURRENT_FROM = "2026-08-01";
const CURRENT_TO = "2026-08-10";
const COMPARE_FROM = "2026-07-22";
const COMPARE_TO = "2026-07-31";
const currentActivities = [
  activity({ id: 1, date_only: "2026-08-02", sport: "running" }),
  activity({ id: 2, date_only: "2026-08-05", sport: "running" }),
];
const compareActivities = [activity({ id: 3, date_only: "2026-07-25", sport: "running" })];

function installMobileFixture() {
  installFetch({
    "GET /api/v1/summary": paginated([sportSummary({ sport: "running", total_activities: currentActivities.length })]),
    "GET /api/v1/range": dateRange(),
    "GET /api/v1/activities": (req: StubRequest) =>
      json(paginated(req.url.searchParams.get("from") === CURRENT_FROM ? currentActivities : compareActivities)),
    "GET /api/v1/settings": settings(),
    "GET /api/v1/date-ranges": paginated([]),
  });
}

function renderMobile(compareEnabled = true) {
  installMobileFixture();
  const compareRange = { ...fakeCompareRange(COMPARE_FROM, COMPARE_TO), enabled: compareEnabled };
  return render(<OverviewTab range={fakeRange(CURRENT_FROM, CURRENT_TO)} compareRange={compareRange} savedRanges={[]} />);
}

describe("OverviewTab mobile comparison-settings & grouping disclosure (HRA-308)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps one grouping selector directly visible and collapses comparison view/match controls into a settings action", async () => {
    stubPhoneWidth(true);
    renderMobile(true);

    // Grouping (Single/Week/Month) stays directly visible, not hidden
    // behind anything — Story AC.
    expect(await screen.findByRole("button", { name: "By activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By month" })).toBeInTheDocument();

    // Overlay/Side by side is NOT a directly-visible button at phone width —
    // it only exists inside the settings disclosure now.
    expect(screen.queryByRole("button", { name: "Overlay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Side by side" })).not.toBeInTheDocument();

    // One icon-only settings action, with an accessible name, reachable
    // from the chart header. HRA-309: Avg HR is hidden by default on phone,
    // so the trigger's own hidden-count badge already reads "1" here.
    const trigger = screen.getByRole("button", { name: "Chart settings, 1 series hidden" });
    expect(trigger).toBeInTheDocument();

    // Its current state (view mode) is visible without opening it.
    expect(screen.getByText("Side by side")).toBeInTheDocument();
  });

  it("opens the settings action to reveal series visibility, compare view, and a tap-accessible Match help", async () => {
    stubPhoneWidth(true);
    renderMobile(true);

    // HRA-309: Avg HR already hidden by default on phone.
    const trigger = await screen.findByRole("button", { name: "Chart settings, 1 series hidden" });
    fireEvent.click(trigger);

    // Series visibility — always offered, even the labels the chart itself
    // already always renders.
    expect(screen.getByText("Series")).toBeInTheDocument();
    const distanceCheckbox = screen.getByRole("checkbox", { name: "Distance" });
    expect(distanceCheckbox).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Avg pace" })).toBeInTheDocument();
    const hrCheckbox = screen.getByRole("checkbox", { name: "Avg HR" });
    expect(hrCheckbox).toBeInTheDocument();
    expect(hrCheckbox).not.toBeChecked();

    // Compare view — progressive disclosure, not a permanent row.
    expect(screen.getByText("Compare view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overlay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side by side" })).toBeInTheDocument();

    // Match order/Match by time — shown because current (2) and compare (1)
    // point counts differ — plus its own tap-accessible help affordance,
    // not a hover-only title.
    expect(screen.getByRole("button", { name: "Match order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match by time" })).toBeInTheDocument();
    const helpTrigger = screen.getByRole("button", { name: "What do Match order and Match by time mean?" });
    fireEvent.click(helpTrigger);
    expect(screen.getByText(/Match order pairs the 1st current point/)).toBeInTheDocument();

    // Toggling a second series off updates the trigger's own accessible
    // state (perceivable without opening the menu again, and not via color
    // alone) — Avg HR (1) + the newly hidden Distance (2).
    fireEvent.click(distanceCheckbox);
    expect(screen.getByRole("button", { name: "Chart settings, 2 series hidden" })).toBeInTheDocument();
  });

  it("hides Overlay/Side by side and Match order/Match by time from the settings surface when comparison is off", async () => {
    stubPhoneWidth(true);
    renderMobile(false);

    const trigger = await screen.findByRole("button", { name: "Chart settings, 1 series hidden" });
    fireEvent.click(trigger);

    expect(screen.getByText("Series")).toBeInTheDocument();
    expect(screen.queryByText("Compare view")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Overlay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Match order" })).not.toBeInTheDocument();
  });

  it("explains a disabled grouping option through a tap-accessible help affordance, not only a hover title", async () => {
    stubPhoneWidth(true);
    renderMobile(true);

    const weekButton = await screen.findByRole("button", { name: "By week" });
    expect(weekButton).toBeDisabled();

    const helpTrigger = screen.getByRole("button", { name: "Why are some grouping options unavailable?" });
    fireEvent.click(helpTrigger);
    expect(screen.getByText(/Needs at least 5 weeks/)).toBeInTheDocument();
    expect(screen.getByText(/Needs at least 5 months/)).toBeInTheDocument();
  });

  it("renders the full desktop control row unchanged (no settings action, grouping+view+match inline) at desktop width", async () => {
    stubPhoneWidth(false);
    renderMobile(true);

    expect(await screen.findByRole("button", { name: "By activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overlay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side by side" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match order" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Match by time" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chart settings" })).not.toBeInTheDocument();
  });
});

// HRA-309 — mobile primary chart legibility: the confirmed 320-390px series
// default (Distance + Avg pace visible, Avg HR hidden, still directly
// re-enableable via HRA-308's ChartSettingsMenu) and its "never overwritten
// by a rerender" persistence.
describe("OverviewTab mobile primary chart legibility (HRA-309)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hides Avg HR by default on initial phone render, with Distance and Avg pace visible", async () => {
    stubPhoneWidth(true);
    renderMobile(true);

    const trigger = await screen.findByRole("button", { name: "Chart settings, 1 series hidden" });
    fireEvent.click(trigger);

    expect(screen.getByRole("checkbox", { name: "Distance" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Avg pace" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Avg HR" })).not.toBeChecked();
  });

  it("keeps a user-enabled Avg HR series visible after switching compare view mode (no overwrite on rerender)", async () => {
    stubPhoneWidth(true);
    renderMobile(true);

    const trigger = await screen.findByRole("button", { name: "Chart settings, 1 series hidden" });
    fireEvent.click(trigger);
    const hrCheckbox = screen.getByRole("checkbox", { name: "Avg HR" });
    expect(hrCheckbox).not.toBeChecked();
    fireEvent.click(hrCheckbox);
    expect(hrCheckbox).toBeChecked();

    // Grouping/comparison-view changes (the same menu's own Overlay control)
    // rerender this pair — the explicit user choice must survive.
    fireEvent.click(screen.getByRole("button", { name: "Overlay" }));
    expect(screen.getByRole("checkbox", { name: "Avg HR" })).toBeChecked();
  });
});
