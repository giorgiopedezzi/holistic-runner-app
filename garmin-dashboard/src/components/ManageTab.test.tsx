/**
 * ManageTab.test.tsx  (HRA-67)
 * The Data & Sync tab fans out many independent fetches on mount (device,
 * both OAuth tokens, counts, previews, trash). This covers the Strava OAuth
 * section's observable connection states end to end, rendered through the
 * whole tab (behaviour-level — it never reaches into a sub-component).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManageTab } from "./ManageTab";
import { installFetch, paginated, type Routes } from "@/test/api-stub";
import { deviceStatus, withingsStatus, stravaStatus } from "@/test/fixtures";

// Every endpoint ManageTab's sections hit on mount, with benign defaults;
// individual tests override the Strava token to drive the states under test.
function mountRoutes(overrides: Routes = {}): Routes {
  return {
    "GET /api/v1/garmin/status": deviceStatus(),
    "GET /api/v1/withings/status": withingsStatus(),
    "GET /api/v1/strava/status": stravaStatus(),
    "GET /api/v1/activities/count": { count: 0 },
    "GET /api/v1/body-measurements/count": { count: 0 },
    "GET /api/v1/activities": paginated([]),
    "GET /api/v1/body-measurements": paginated([]),
    "GET /api/v1/activities/trash": paginated([]),
    "GET /api/v1/body-measurements/trash": paginated([]),
    ...overrides,
  };
}

// Same stubViewport pattern SplashScreen.test.tsx already uses for the
// PHONE_MAX_WIDTH_PX (767px) query useIsPhone.ts reads.
function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ManageTab — Strava OAuth section", () => {
  it("shows a not-connected state with a login button when there is no token", async () => {
    installFetch(mountRoutes({ "GET /api/v1/strava/status": stravaStatus({ present: false, valid: false }) }));
    render(<ManageTab savedRanges={[]} />);

    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login to Strava" })).toBeInTheDocument();
  });

  it("shows a connected state with a re-login button when the token is valid", async () => {
    installFetch(mountRoutes({
      "GET /api/v1/strava/status": stravaStatus({ present: true, valid: true }),
    }));
    render(<ManageTab savedRanges={[]} />);

    expect(await screen.findByText(/^Connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-login" })).toBeInTheDocument();
  });
});

describe("ManageTab — phone grouping (HRA-278)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups the 7 sections into 4 collapsed subviews at phone width, keeping sync and delete apart", async () => {
    stubViewport(true);
    installFetch(mountRoutes());
    render(<ManageTab savedRanges={[]} />);

    // The 4 group headers are reachable immediately; their content is not
    // mounted until expanded (AccordionCard only renders children when open).
    expect(screen.getByRole("button", { name: /Sync sources/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saved ranges/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Classify/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Local data & Trash/ })).toBeInTheDocument();
    expect(screen.queryByText("Delete — local database only")).not.toBeInTheDocument();

    // Expanding "Local data & Trash" reveals both Delete and Trash — but
    // never pulls in the Sync group's own content.
    fireEvent.click(screen.getByRole("button", { name: /Local data & Trash/ }));
    expect(await screen.findByText("Delete — local database only")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trash" })).toBeInTheDocument();
    expect(screen.queryByText("Not connected to Strava")).not.toBeInTheDocument();
  });

  it("renders the flat, ungrouped desktop layout unchanged above phone width", async () => {
    stubViewport(false);
    installFetch(mountRoutes());
    render(<ManageTab savedRanges={[]} />);

    // No group headers — every section's own heading is reachable directly,
    // exactly as before this Story.
    expect(screen.queryByRole("button", { name: /Sync sources/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Local data & Trash/ })).not.toBeInTheDocument();
    expect(screen.getByText("Delete — local database only")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trash" })).toBeInTheDocument();
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();
  });
});
