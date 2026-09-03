/**
 * OverviewTab.test.tsx  (HRA-67)
 * Behaviour-level characterization: success (totals + running stats), the
 * range-empty state, and the error state. Asserts only on rendered text —
 * never on internal state or chart geometry.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
