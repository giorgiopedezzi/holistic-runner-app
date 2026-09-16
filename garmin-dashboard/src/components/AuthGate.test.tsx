import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthGate } from "./AuthGate";
import { ApiError, api } from "@/api/client";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AuthGate", () => {
  it("boots a guest shell without mounting private product content", async () => {
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));
    const login = vi.spyOn(api.auth, "login").mockImplementation(() => undefined);

    render(<AuthGate><div>Private dashboard</div></AuthGate>);

    expect(await screen.findByText("Founder journey")).toBeInTheDocument();
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText(/you.?re signed out/i)).not.toBeInTheDocument();
    expect(api.auth.session).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with email code" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(login).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledWith();
  });

  it("mounts the private app for an authenticated session", async () => {
    vi.spyOn(api.auth, "session").mockResolvedValue({
      user: { id: "founder", display_name: "Founder", locale: "en", unit_system: "metric", timezone: "Europe/Rome", role: "admin" },
      entitlements: [], csrfToken: "test-csrf",
    });

    render(<AuthGate><div>Private dashboard</div></AuthGate>);

    expect(await screen.findByText("Private dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Founder journey")).not.toBeInTheDocument();
  });

  it("uses the existing phone drawer pattern for Guest navigation", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));
    const { container } = render(<AuthGate><div>Private dashboard</div></AuthGate>);

    await screen.findByText("Founder journey");
    const sidebar = () => container.querySelector(".hra-sidebar");
    expect(sidebar()).toHaveAttribute("data-tier", "phone");
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

  it("keeps the published current plan in stable Guest navigation", async () => {
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));

    render(<AuthGate><div>Private dashboard</div></AuthGate>);

    const currentPlan = await screen.findByRole("button", { name: "Current plan" });
    fireEvent.click(currentPlan);

    expect(currentPlan).toHaveAttribute("aria-current", "page");
    expect(window.location.pathname).toBe("/p/founder-journey/plan");
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    // Settles the unstubbed public-profile fetch (this test only asserts on
    // the sidebar/URL, not GuestOverview's own content) before the test ends,
    // so its rejection doesn't update React state after the test has finished.
    await screen.findByText("This published journey is currently unavailable.");
  });
});
