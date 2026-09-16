import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuestOverview } from "./GuestOverview";
import { installFetch } from "@/test/api-stub";

const base = "/api/v1/public/profiles/founder-journey";
const projectedAt = "2026-09-16T08:00:00.000Z";

function published(data: unknown) {
  return { slug: "founder-journey", projectedAt, data };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("routes a personal Guest conversion point into the supplied sign-in flow", async () => {
    const onSignIn = vi.fn();
    installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: {} }),
      [`GET ${base}/activities`]: published([]),
      [`GET ${base}/plans`]: published([]),
      [`GET ${base}/reports`]: published([]),
    });

    render(<GuestOverview onSignIn={onSignIn} />);

    fireEvent.click(await screen.findByRole("button", { name: "Try Runs Free with your training" }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(screen.getByText("Start your own running journey")).toBeInTheDocument();
  });

  it("renders the public effective-plan current week without private mutation controls", async () => {
    const fetch = installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: { displayName: "Giorgio" } }),
      [`GET ${base}/activities`]: published([]),
      [`GET ${base}/plans`]: published([{
        publicId: "plan-1",
        fields: {
          name: "Boston build", startDate: "2026-09-01", raceDate: "2026-12-01",
          workouts: [
            { date: "2026-09-14", workoutType: "run", title: "Easy run", original: { title: "Base run" }, current: { title: "Easy run" }, actual: { title: "Completed easy run" } },
            { date: "2026-09-15", workoutType: "rest" },
            { date: "2026-09-16", workoutType: "unsupported" },
          ],
        },
      }]),
      [`GET ${base}/reports`]: published([]),
    });

    render(<GuestOverview view="plan" />);

    expect(await screen.findByRole("heading", { name: "Boston build" })).toBeInTheDocument();
    expect(screen.getByText("Easy run")).toBeInTheDocument();
    expect(screen.getByText("Original: Base run")).toBeInTheDocument();
    expect(screen.getByText("Current: Easy run")).toBeInTheDocument();
    expect(screen.getByText("Actual: Completed easy run")).toBeInTheDocument();
    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText("Published workout details are unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("No workout published")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /edit|swap|export|sync/i })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname)).toEqual([
      base, `${base}/activities`, `${base}/plans`, `${base}/reports`,
    ]);
  });

  it("opens an activity using its opaque public ID and renders only published metrics", async () => {
    const activityId = "activity-1";
    const fetch = installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: {} }),
      [`GET ${base}/activities`]: published([{ publicId: activityId, fields: { title: "Long run", date: "2026-09-15", distanceM: 21000 } }]),
      [`GET ${base}/activities/${activityId}`]: published({ publicId: activityId, fields: {
        title: "Long run", date: "2026-09-15", distanceM: 21000, durationSec: 7500, movingTimeSec: 7200,
        avgPaceMinKm: 5.7, avgHr: 144, maxHr: 162, avgCadence: 176, ascentM: 235, descentM: 221,
        latitude: 45.1, note: "private", track: [{ elapsedSec: 0, distanceM: 0, heartRate: 120 }],
      } }),
      [`GET ${base}/plans`]: published([]),
      [`GET ${base}/reports`]: published([]),
    });

    render(<GuestOverview view="activities" />);

    fireEvent.click(await screen.findByRole("button", { name: /long run/i }));

    expect(await screen.findByText("Average heart rate")).toBeInTheDocument();
    expect(screen.getByText("144 bpm")).toBeInTheDocument();
    expect(screen.getByText("235 m")).toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname)).toEqual([
      base, `${base}/activities`, `${base}/plans`, `${base}/reports`, `${base}/activities/${activityId}`,
    ]);
  });

  it("opens public planned-versus-actual evidence by opaque ID without recalculating or fabricating metrics", async () => {
    const reportId = "report-1";
    const fetch = installFetch({
      [`GET ${base}`]: published({ publicId: "profile-1", fields: {} }),
      [`GET ${base}/activities`]: published([]),
      [`GET ${base}/plans`]: published([]),
      [`GET ${base}/reports`]: published([{ publicId: reportId, fields: { kind: "plan", generatedAt: "2026-09-15" } }]),
      [`GET ${base}/reports/${reportId}`]: published({ publicId: reportId, fields: {
        kind: "plan", generatedAt: "2026-09-15", datasets: {
          original: { distanceM: 42000, durationSec: 14400, paceSecPerKm: 343 },
          current: { distanceM: 40000 }, actual: {},
        }, coverage: { trustedActivities: 4, ambiguousActivities: 1, extraActivities: 2 },
        comparisons: { execution: [{ status: "completed" }], outcome: [] },
      } }),
    });

    render(<GuestOverview view="reports" />);

    fireEvent.click(await screen.findByRole("button", { name: /plan/i }));

    expect(await screen.findByText("Original plan")).toBeInTheDocument();
    expect(screen.getByText("42.00 km")).toBeInTheDocument();
    expect(screen.getByText("Effective plan")).toBeInTheDocument();
    expect(screen.getByText("No accepted actual activity was published.")).toBeInTheDocument();
    expect(screen.getByText("Accepted actual activities")).toBeInTheDocument();
    expect(screen.getByText("Unmatched or ambiguous activities")).toBeInTheDocument();
    expect(screen.getByText("Execution")).toBeInTheDocument();
    expect(screen.queryByText("0 km")).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname)).toEqual([
      base, `${base}/activities`, `${base}/plans`, `${base}/reports`, `${base}/reports/${reportId}`,
    ]);
  });
});
