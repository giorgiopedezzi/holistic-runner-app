/**
 * App.test.tsx  (HRA-67)
 * Tab switching across all five tabs, and the LOAD-BEARING unit-propagation
 * regression: a unit-system change made on the Settings tab must be reflected
 * on another tab after switching to it. This guards the conditional-render /
 * unmount-remount contract in App.tsx together with utils/units.ts's
 * module-scope unit system — see Epic HRA-65's load-bearing constraint and
 * CLAUDE.md ("tabs are conditionally rendered, not hidden"). If someone
 * "optimises" tabs to stay mounted, THIS test is what fails.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { installFetch, paginated, json, type Routes } from "@/test/api-stub";
import {
  activity, sportSummary, bodyMeasurement, settings, dateRange,
  deviceStatus, withingsStatus, stravaStatus,
} from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";

// A broad stub covering every endpoint any tab hits on mount, so tab switches
// render real content. `settingsBody` lets a test control the persisted units;
// a PUT to /settings/units flips it (used by the propagation test).
function appRoutes(settingsBody = settings()): Routes {
  return {
    "GET /api/v1/settings": settingsBody,
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
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("App tab switching", () => {
  it("mounts each of the five tabs when its nav button is clicked", async () => {
    installFetch(appRoutes());
    render(<App />);

    // Overview is the default tab.
    expect(await screen.findByText("Total")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText("2026-08-01")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    expect(await screen.findByText(/Latest measurement/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Appearance")).toBeInTheDocument();
  });
});

describe("unit-system propagation across tabs (load-bearing)", () => {
  it("reflects a metric→imperial change on another tab after switching to it", async () => {
    const fetchMock = installFetch({
      ...appRoutes(settings({ unit_system: "metric" })),
      // Flipping units returns the imperial settings; useAppearance applies it
      // to the module-scope unit system via setUnitSystem.
      "PUT /api/v1/settings/units": json(settings({ unit_system: "imperial" })),
    });
    render(<App />);

    // Overview (default) shows the running avg-pace unit label in metric.
    expect(await screen.findByText("min/km")).toBeInTheDocument();
    expect(screen.queryByText("min/mi")).not.toBeInTheDocument();

    // Switch to Settings and choose Imperial. The save is async, so wait until
    // the (module-scope) unit system has actually flipped before switching
    // tabs — otherwise Overview would remount while units were still metric.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Imperial (mi, lb)" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings/units"), expect.objectContaining({ method: "PUT" })),
    );
    await waitFor(() => expect(getUnitSystem()).toBe("imperial"));

    // Switch back to Overview — the tab remounts and re-reads the (now
    // imperial) module unit system.
    fireEvent.click(screen.getByRole("button", { name: "Overview & Trends" }));
    await waitFor(() => expect(screen.getByText("min/mi")).toBeInTheDocument());
    expect(screen.queryByText("min/km")).not.toBeInTheDocument();
  });
});
