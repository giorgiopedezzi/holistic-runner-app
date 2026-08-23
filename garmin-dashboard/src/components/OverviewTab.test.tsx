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
import { installFetch, json, problem, paginated } from "@/test/api-stub";
import { sportSummary, dateRange, settings } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";

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
});
