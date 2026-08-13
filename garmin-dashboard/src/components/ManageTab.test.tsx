/**
 * ManageTab.test.tsx  (HRA-67)
 * The Data & Sync tab fans out many independent fetches on mount (device,
 * both OAuth tokens, counts, previews, trash). This covers the Strava OAuth
 * section's observable connection states end to end, rendered through the
 * whole tab (behaviour-level — it never reaches into a sub-component).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

afterEach(() => vi.unstubAllGlobals());

describe("ManageTab — Strava OAuth section", () => {
  it("shows a not-connected state with a login button when there is no token", async () => {
    installFetch(mountRoutes({ "GET /api/v1/strava/status": stravaStatus({ present: false, valid: false }) }));
    render(<ManageTab />);

    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login to Strava" })).toBeInTheDocument();
  });

  it("shows a connected state with a re-login button when the token is valid", async () => {
    installFetch(mountRoutes({
      "GET /api/v1/strava/status": stravaStatus({ present: true, valid: true }),
    }));
    render(<ManageTab />);

    expect(await screen.findByText(/^Connected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-login" })).toBeInTheDocument();
  });
});
