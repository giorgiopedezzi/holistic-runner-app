import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuestShell } from "./GuestShell";
import { installFetch } from "@/test/api-stub";

const base = "/api/v1/public/profiles/founder-journey";
const projectedAt = "2026-09-16T08:00:00.000Z";

function published(data: unknown) {
  return { slug: "founder-journey", projectedAt, data };
}

function stubPublicProfile() {
  return installFetch({
    [`GET ${base}`]: published({ publicId: "profile-1", fields: { displayName: "Giorgio" } }),
    [`GET ${base}/activities`]: published([{ publicId: "activity-1", fields: { title: "Long run", date: "2026-09-15", distanceM: 21000 } }]),
    [`GET ${base}/plans`]: published([]),
    [`GET ${base}/reports`]: published([{ publicId: "report-1", fields: { kind: "plan" } }]),
    [`GET ${base}/activities/activity-1`]: published({ publicId: "activity-1", fields: { title: "Long run", distanceM: 21000 } }),
    [`GET ${base}/reports/report-1`]: published({ publicId: "report-1", fields: { kind: "plan" } }),
  });
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("GuestShell", () => {
  it("restores the current-plan view from a direct load of its public URL", async () => {
    window.history.replaceState({}, "", "/p/founder-journey/plan");
    stubPublicProfile();

    render(<GuestShell />);

    const currentPlan = await screen.findByRole("button", { name: "Current plan" });
    expect(currentPlan).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Current training plan" })).toBeInTheDocument();
  });

  it("restores a specific activity from a direct load of its public URL, without requiring a click", async () => {
    window.history.replaceState({}, "", "/p/founder-journey/activities/activity-1");
    const fetch = stubPublicProfile();

    render(<GuestShell />);

    expect(await screen.findByRole("button", { name: "Activities" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("button", { pressed: true })).toHaveTextContent(/long run/i);
    expect(fetch.mock.calls.map(([url]) => new URL(String(url), "http://localhost").pathname)).toContain(`${base}/activities/activity-1`);
  });

  it("restores a specific published comparison from a direct load of its public URL", async () => {
    window.history.replaceState({}, "", "/p/founder-journey/reports/report-1");
    stubPublicProfile();

    render(<GuestShell />);

    expect(await screen.findByRole("button", { name: "Progress" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("button", { pressed: true })).toHaveTextContent(/plan/i);
  });

  it("navigating within Guest updates the URL to the stable public route family", async () => {
    window.history.replaceState({}, "", "/p/founder-journey");
    stubPublicProfile();

    render(<GuestShell />);

    fireEvent.click(await screen.findByRole("button", { name: "Activities" }));
    expect(window.location.pathname).toBe("/p/founder-journey/activities");

    fireEvent.click(await screen.findByRole("button", { pressed: false }));
    expect(window.location.pathname).toBe("/p/founder-journey/activities/activity-1");
    await screen.findByRole("region", { name: "Published activity detail" });
  });

  it("restores the view on a browser back navigation (popstate), not just on mount", async () => {
    window.history.replaceState({}, "", "/p/founder-journey");
    stubPublicProfile();

    render(<GuestShell />);
    await screen.findByRole("heading", { name: "Giorgio's road to the start line" });

    window.history.pushState({}, "", "/p/founder-journey/plan");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(await screen.findByRole("button", { name: "Current plan" })).toHaveAttribute("aria-current", "page");
  });
});
