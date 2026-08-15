/**
 * BodyTab.test.tsx  (HRA-67)
 * Behaviour-level: latest-measurement + metrics on success, range-empty, error.
 * The primary metric chart mounts under the ResizeObserver stub; assertions
 * stay on text (stat cards / headings), never chart geometry.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BodyTab } from "./BodyTab";
import { installFetch, problem, paginated } from "@/test/api-stub";
import { bodyMeasurement, dateRange } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("BodyTab", () => {
  it("renders the latest measurement and its stats on success", async () => {
    installFetch({
      "GET /api/v1/body-measurements": paginated([bodyMeasurement()]),
      "GET /api/v1/body-measurements/correlation": paginated([]),
      "GET /api/v1/body-measurements/range": dateRange(),
    });
    render(<BodyTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(/Latest measurement — 2026-08-01/)).toBeInTheDocument();
    // Stat now splits "72.4 kg" into a value div + a smaller inline unit
    // span (polish pass, ui/Stat.tsx's splitUnit) — match on the div's full
    // textContent rather than a single text node.
    expect(screen.getByText((_, node) => node?.tagName.toLowerCase() === "div" && node.textContent === "72.4 kg")).toBeInTheDocument();
  });

  it("shows the range-empty message when there are no measurements", async () => {
    installFetch({
      "GET /api/v1/body-measurements": paginated([]),
      "GET /api/v1/body-measurements/correlation": paginated([]),
      "GET /api/v1/body-measurements/range": dateRange(),
    });
    render(<BodyTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(/No body measurements in the selected range/i)).toBeInTheDocument();
  });

  it("surfaces the API error message on failure", async () => {
    installFetch({
      "GET /api/v1/body-measurements": () => problem(500, "body query failed"),
      "GET /api/v1/body-measurements/correlation": paginated([]),
      "GET /api/v1/body-measurements/range": dateRange(),
    });
    render(<BodyTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText("body query failed")).toBeInTheDocument();
  });
});
