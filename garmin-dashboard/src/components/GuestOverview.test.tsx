import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuestOverview } from "./GuestOverview";
import { installFetch } from "@/test/api-stub";

const base = "/api/v1/public/profiles/founder-journey";
const projectedAt = "2026-09-16T08:00:00.000Z";

function published(data: unknown) {
  return { slug: "founder-journey", projectedAt, data };
}

afterEach(() => vi.unstubAllGlobals());

describe("GuestOverview", () => {
  it("renders public founder, plan, activity, and report signals without private reads", async () => {
    const fetch = installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: { displayName: "Giorgio", bio: "Boston 2028" } }),
      [`GET ${base}/activities`]: published([{ publicId: "activity-1", fields: { title: "Long run", date: "2026-09-15", distanceM: 21000, movingTimeSec: 7200, avgPaceMinKm: 5.7 } }]),
      [`GET ${base}/plans`]: published([{ publicId: "plan-1", fields: { name: "Boston build", raceName: "Boston Marathon", raceDate: "2028-04-17" } }]),
      [`GET ${base}/reports`]: published([{ publicId: "report-1", fields: { kind: "plan" } }]),
    });

    render(<GuestOverview />);

    expect(await screen.findByRole("heading", { name: "Giorgio's road to the start line" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Boston build" })).toBeInTheDocument();
    expect(screen.getByText("Long run")).toBeInTheDocument();
    expect(screen.getByText("21.00 km")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname)).toEqual([
      base, `${base}/activities`, `${base}/plans`, `${base}/reports`,
    ]);
  });

  it("does not turn unavailable public data into zero values", async () => {
    installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: {} }),
      [`GET ${base}/activities`]: published([]),
      [`GET ${base}/plans`]: published([]),
      [`GET ${base}/reports`]: published([]),
    });

    render(<GuestOverview />);

    expect(await screen.findByText("A runner's road to the start line")).toBeInTheDocument();
    expect(screen.getByText("A current target has not been published.")).toBeInTheDocument();
    expect(screen.getByText("No recent training has been published.")).toBeInTheDocument();
    expect(screen.queryByText("0 km")).not.toBeInTheDocument();
  });
});
