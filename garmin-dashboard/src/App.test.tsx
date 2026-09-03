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
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "./App";
import { installFetch, paginated, json, problem, type Routes } from "@/test/api-stub";
import {
  activity, sportSummary, bodyMeasurement, settings, dateRange,
  deviceStatus, withingsStatus, stravaStatus,
} from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";
import { fmtDate } from "@/utils/fmt";

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
    // HRA-248: "Your agenda" is now the default tab, so every mount fetches
    // this on render — a benign "no active plan today" default, same
    // reasoning as every other benign stub above.
    "GET /api/v1/plan-instances/active": problem(404, "no active plan"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  // HRA-193: tab state now lives in the URL (history.replaceState), which
  // persists across tests sharing this jsdom window — reset it so a later
  // test doesn't inherit an earlier test's tab.
  window.history.replaceState(null, "", "/");
});

describe("App tab switching", () => {
  it("loads on the default 'Your agenda' tab, first in nav order, then mounts each other tab when clicked", async () => {
    installFetch(appRoutes());
    render(<App />);

    // HRA-248 AC1 (still true post-HRA-253): no tab URL param -> "Your
    // agenda" selected, first in the sidebar's Primary group.
    const nav = screen.getByRole("navigation");
    const navButtons = within(nav).getAllByRole("button");
    expect(navButtons[0]).toHaveTextContent("Your agenda");
    expect(navButtons[1]).toHaveTextContent("Training plans");
    expect(await screen.findByText("There is no active plan today.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview & Trends" }));
    // Longer timeout than the default 1000ms — the graph-first layout (main
    // graph + sidebar) now renders through a few more nested components
    // before settling, confirmed correct via manual inspection, just slower
    // to converge in this test environment.
    await waitFor(() => expect(document.body).toHaveTextContent("Avg distance"), { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText(fmtDate("2026-08-01"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    expect(await screen.findByText(/Latest measurement/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Appearance")).toBeInTheDocument();
  });

  it("renders exactly one nav landmark, grouped Primary/Review/Manage/utility, with the old horizontal header gone (HRA-253)", async () => {
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    // Exactly one nav landmark for the whole sidebar.
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation");
    const navButtons = within(nav).getAllByRole("button");
    expect(navButtons.map(b => b.textContent)).toEqual([
      "Your agenda", "Training plans",
      "Overview & Trends", "Activities", "Body",
      "Data & Sync",
      "Settings", "Feedback",
    ]);

    // Review/Manage group headings are present and precede their items in
    // document order (Primary has no heading, per scope).
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Manage")).toBeInTheDocument();

    // The old horizontal header/nav bar no longer renders anywhere.
    expect(container.querySelector(".hra-header")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-nav")).not.toBeInTheDocument();
    expect(screen.queryByText("Garmin Stats")).not.toBeInTheDocument();
    expect(screen.getByText("Runs Free")).toBeInTheDocument();

    // Post-review feedback: the server-status dot was removed from the
    // sidebar entirely (no role="status" indicator renders anywhere), and
    // the language picker sits next to the brand instead of in a footer.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-status-dot")).not.toBeInTheDocument();
  });

  it("marks exactly one sidebar item aria-current='page', matching the active tab, and updates it on click", async () => {
    installFetch(appRoutes());
    render(<App />);
    await screen.findByText("There is no active plan today.");

    const nav = screen.getByRole("navigation");
    const current = () => within(nav).getAllByRole("button").filter(b => b.getAttribute("aria-current") === "page");

    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Your agenda");

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    await screen.findByText("Not connected to Strava");

    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Data & Sync");
  });

  it("selects the matching sidebar item as current when a tab is opened directly via URL (?tab=body)", async () => {
    installFetch(appRoutes());
    window.history.replaceState(null, "", "/?tab=body");
    render(<App />);
    await screen.findByText(/Latest measurement/);

    const nav = screen.getByRole("navigation");
    const bodyButton = within(nav).getByRole("button", { name: "Body" });
    expect(bodyButton).toHaveAttribute("aria-current", "page");
  });

  it("preserves existing from/to/compareFrom/compareTo/compareEnabled query params on a sidebar navigation click", async () => {
    installFetch(appRoutes());
    window.history.replaceState(null, "", "/?from=2026-07-01&to=2026-07-31&compareFrom=2026-06-01&compareTo=2026-06-30&compareEnabled=true");
    render(<App />);
    await screen.findByText("There is no active plan today.");

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    await screen.findByText("Not connected to Strava");

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("manage");
    expect(params.get("from")).toBe("2026-07-01");
    expect(params.get("to")).toBe("2026-07-31");
    expect(params.get("compareFrom")).toBe("2026-06-01");
    expect(params.get("compareTo")).toBe("2026-06-30");
    expect(params.get("compareEnabled")).toBe("true");
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

    // HRA-248: "Your agenda", not Overview, is the default tab now — switch
    // to Overview first to exercise the same propagation path as before.
    fireEvent.click(await screen.findByRole("button", { name: "Overview & Trends" }));
    // Overview shows the running avg-pace unit label in metric. Longer
    // timeout — see the same note above.
    await waitFor(() => expect(document.body).toHaveTextContent("min/km"), { timeout: 5000 });
    expect(screen.queryByText("min/mi")).not.toBeInTheDocument();

    // Switch to Settings and choose Imperial. The save is async, so wait until
    // the (module-scope) unit system has actually flipped before switching
    // tabs — otherwise Overview would remount while units were still metric.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // Settings sections are accordion cards now — expand "Units" first.
    fireEvent.click(await screen.findByRole("button", { name: /^Units/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Imperial (mi, lb)" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings/units"), expect.objectContaining({ method: "PUT" })),
    );
    await waitFor(() => expect(getUnitSystem()).toBe("imperial"));

    // Switch back to Overview — the tab remounts and re-reads the (now
    // imperial) module unit system.
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Overview & Trends" }));
    await waitFor(() => expect(screen.getByText("min/mi")).toBeInTheDocument());
    expect(screen.queryByText("min/km")).not.toBeInTheDocument();
  });
});
