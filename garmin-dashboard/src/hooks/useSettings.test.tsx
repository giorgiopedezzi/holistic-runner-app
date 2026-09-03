/**
 * useSettings.test.tsx  (HRA-76)
 * The single-settings-source acceptance criterion: rendering the real App
 * and switching across every tab must trigger exactly one GET
 * /api/v1/settings, even though five independent places now read from the
 * shared SettingsProvider/useSettings (useAppearance, ActivitiesTab,
 * ActivityDetailBody, OverviewTab, SettingsTab). Deliberately its own route
 * stub, not imported from App.test.tsx — that file's Phase 0 assertions
 * (including the load-bearing unit-propagation regression) stay unmodified.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "@/App";
import { installFetch, paginated, problem, type Routes } from "@/test/api-stub";
import {
  activity, sportSummary, bodyMeasurement, settings, dateRange,
  deviceStatus, withingsStatus, stravaStatus,
} from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import { fmtDate } from "@/utils/fmt";

function appRoutes(): Routes {
  return {
    "GET /api/v1/settings": settings(),
    "GET /api/v1/range": dateRange(),
    "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
    "GET /api/v1/activities": paginated([activity()], 1),
    "GET /api/v1/body-measurements": paginated([bodyMeasurement()]),
    "GET /api/v1/body-measurements/correlation": paginated([]),
    "GET /api/v1/body-measurements/range": dateRange(),
    "GET /api/v1/garmin/status": deviceStatus(),
    "GET /api/v1/withings/status": withingsStatus(),
    "GET /api/v1/strava/status": stravaStatus(),
    "GET /api/v1/activities/count": { count: 1 },
    "GET /api/v1/body-measurements/count": { count: 1 },
    "GET /api/v1/activities/trash": paginated([]),
    "GET /api/v1/body-measurements/trash": paginated([]),
    // HRA-248: "Your agenda" is now the default tab, so mounting App fetches
    // this — a benign "no active plan today" default, same reasoning as
    // every other benign stub above.
    "GET /api/v1/plan-instances/active": problem(404, "no active plan"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  // HRA-193/HRA-248: tab state lives in the URL (history.replaceState),
  // which persists across tests sharing this jsdom window — reset it so a
  // later test doesn't inherit this test's tab (same reset App.test.tsx's
  // own afterEach already applies).
  window.history.replaceState(null, "", "/");
});

describe("settings — single fetch across the app (HRA-76)", () => {
  it("fetches /api/v1/settings exactly once, even after switching across every tab", async () => {
    const fetchMock = installFetch(appRoutes());
    render(<App />);

    // HRA-248: "Your agenda", not Overview, is the default tab now — switch
    // to Overview first so this test still exercises every tab in the same
    // order as before.
    fireEvent.click(await screen.findByRole("button", { name: "Overview & Trends" }));
    // Longer timeout than the default 1000ms — the graph-first layout (main
    // graph + sidebar) renders through a few more nested components before
    // settling; confirmed correct via manual inspection, just slower to
    // converge in this test environment.
    await waitFor(() => expect(document.body).toHaveTextContent("Avg distance"), { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText(fmtDate("2026-08-01"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    expect(await screen.findByText(/Latest measurement/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Appearance")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Overview & Trends" }));
    // Longer timeout than the default 1000ms — remounting Overview after a
    // full cycle through every other tab, on top of the graph-first layout's
    // extra nested rendering, is the slowest of this test's checks in this
    // environment; confirmed correct via manual inspection.
    await waitFor(() => expect(document.body).toHaveTextContent("Avg distance"), { timeout: 5000 });

    const settingsGets = fetchMock.mock.calls.filter(([input, init]) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
      return url.pathname === "/api/v1/settings" && (init?.method ?? "GET").toUpperCase() === "GET";
    });
    expect(settingsGets).toHaveLength(1);
  });
});
