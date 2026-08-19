/**
 * ActivitiesTab.test.tsx  (HRA-67)
 * Behaviour-level: paged list, range-empty, and error states.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivitiesTab } from "./ActivitiesTab";
import { installFetch, problem, paginated } from "@/test/api-stub";
import { activity, dateRange, settings } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import { fmtDate } from "@/utils/fmt";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("ActivitiesTab", () => {
  it("renders a page of activities on success", async () => {
    installFetch({
      "GET /api/v1/activities": paginated([activity()], 1),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(fmtDate("2026-08-01"))).toBeInTheDocument();
    expect(screen.getByText("10.00 km")).toBeInTheDocument();
    // Pagination renders above and below the list, so the total appears twice.
    expect(screen.getAllByText(/1 total/).length).toBeGreaterThan(0);
  });

  it("shows the range-empty message when the page is empty", async () => {
    installFetch({
      "GET /api/v1/activities": paginated([], 0),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(/No activities in the selected range/i)).toBeInTheDocument();
  });

  it("surfaces the API error message on failure", async () => {
    installFetch({
      "GET /api/v1/activities": () => problem(503, "activities unavailable"),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    // 503 is remapped to the gateway-busy message by the real client (HRA-43).
    expect(await screen.findByText(/Couldn't reach the API server/i)).toBeInTheDocument();
  });
});
