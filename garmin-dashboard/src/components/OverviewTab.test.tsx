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

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("OverviewTab", () => {
  it("renders totals and a running section on success", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
    });
    render(<OverviewTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    // Running avg-pace stat carries the unit label from the module unit system.
    expect(screen.getByText("min/km")).toBeInTheDocument();
  });

  it("shows the range-empty message when the range holds no activities", async () => {
    installFetch({
      "GET /api/v1/summary": paginated([]),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
    });
    render(<OverviewTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(/No activities in the selected range/i)).toBeInTheDocument();
  });

  it("surfaces the API error message on failure", async () => {
    installFetch({
      "GET /api/v1/summary": () => problem(500, "summary blew up"),
      "GET /api/v1/range": () => json(dateRange()),
      "GET /api/v1/activities": paginated([]),
      "GET /api/v1/settings": settings(),
    });
    render(<OverviewTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText("summary blew up")).toBeInTheDocument();
  });
});
