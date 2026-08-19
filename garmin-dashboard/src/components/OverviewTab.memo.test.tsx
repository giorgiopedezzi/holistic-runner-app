/**
 * OverviewTab.memo.test.tsx  (HRA-78)
 * Proves TrendsBySport's sport-grouping/sort (groupActivitiesBySport,
 * domain/trends.ts) is genuinely memoized, not just wrapped in useMemo for
 * show: renders the real tab, spies on the (real, unmocked) domain function,
 * and asserts it's called once on mount and NOT again when an unrelated
 * re-render happens (clicking the "Single" grouping button, which doesn't
 * touch the activities array the memo depends on).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";
import { installFetch, paginated } from "@/test/api-stub";
import { activity, sportSummary, settings, dateRange } from "@/test/fixtures";
import * as trends from "@/domain/trends";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";

// See OverviewTab.test.tsx's identical helpers — OverviewTab takes the full
// live range state now (it renders its own DateRangeBar); this test never
// clicks it, so the setters are no-ops.
function fakeRange(from: string, to: string): DateRangeState {
  return { from, to, setFrom: () => {}, setTo: () => {}, setPreset: () => {} };
}
function fakeCompareRange(from: string, to: string): CompareRangeState {
  return { from, to, setFrom: () => {}, setTo: () => {}, enabled: true, setEnabled: () => {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TrendsBySport sport-grouping memoization", () => {
  it("recomputes on mount, not again on an unrelated re-render", async () => {
    const spy = vi.spyOn(trends, "groupActivitiesBySport");

    installFetch({
      "GET /api/v1/settings": settings(),
      "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
      "GET /api/v1/activities": paginated([activity({ id: 1 }), activity({ id: 2 })]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/date-ranges": paginated([]),
    });

    render(<OverviewTab range={fakeRange("2026-07-01", "2026-08-01")} compareRange={fakeCompareRange("2026-06-01", "2026-06-30")} />);

    expect(await screen.findByText("Distance & pace/HR trend")).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const callsAfterMount = spy.mock.calls.length;

    // "Single" is always enabled regardless of data, so this re-renders
    // TrendsBySport via groupMode changing — activities itself is untouched.
    fireEvent.click(screen.getByRole("button", { name: "Single" }));

    expect(spy.mock.calls.length).toBe(callsAfterMount);
  });
});
