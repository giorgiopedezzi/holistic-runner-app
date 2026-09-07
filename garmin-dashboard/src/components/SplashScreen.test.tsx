/**
 * SplashScreen.test.tsx
 * The splash's phone composition. At phone width the desktop stack (card +
 * three KPI boxes + a two-axis 220px plot) is far taller than the screen it
 * gates, and the layer centers its overflow — so both ends were unreachable.
 * These tests pin what the phone branch renders instead: the runner and a raw
 * summary line, with the card/KPI/chart chrome gone and Skip still reachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SplashScreen } from "./SplashScreen";
import { installFetch } from "@/test/api-stub";
import { activity, shortTrack } from "@/test/fixtures";

// The splash replays activity 201 (SPLASH_ACTIVITY_ID).
const SPLASH_ID = 201;

function splashRoutes() {
  return {
    [`GET /api/v1/activities/${SPLASH_ID}`]: activity({ id: SPLASH_ID, distance_m: 12300, avg_speed_ms: 2.5, avg_hr: 148 }),
    // The track endpoint returns a bare array, not the paginated envelope
    // every collection endpoint uses.
    [`GET /api/v1/activities/${SPLASH_ID}/track`]: shortTrack(),
  };
}

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

beforeEach(() => {
  // The splash remembers its own dismissal for the tab session; each test
  // needs it unshown.
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("SplashScreen — phone composition", () => {
  it("drops the card, the KPI boxes and the chart, keeping the numbers as one raw line", async () => {
    stubViewport(true);
    installFetch(splashRoutes());
    const { container } = render(<SplashScreen />);

    // The three KPI values, unboxed and on one line.
    await waitFor(() => expect(screen.getByText(/^12\.30 km · .+ · 148 bpm$/)).toBeInTheDocument());
    expect(container.querySelector(".hra-chart-card")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-kpi-value")).not.toBeInTheDocument();
    // The runner itself survives — it's the whole point of the screen.
    expect(container.querySelector(".hra-runner-row")).toBeInTheDocument();
  });

  it("keeps Skip working", async () => {
    stubViewport(true);
    installFetch(splashRoutes());
    const { container } = render(<SplashScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(container.querySelector(".hra-splash-layer")).not.toBeInTheDocument());
  });

  it("still builds the carded, KPI-boxed composition above phone width", async () => {
    stubViewport(false);
    installFetch(splashRoutes());
    const { container } = render(<SplashScreen />);

    await waitFor(() => expect(container.querySelector(".hra-chart-card")).toBeInTheDocument());
    expect(screen.getByText("Distance")).toBeInTheDocument();
    expect(screen.getByText("Avg HR")).toBeInTheDocument();
  });
});
