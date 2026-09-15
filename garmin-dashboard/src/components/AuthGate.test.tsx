import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthGate } from "./AuthGate";
import { ApiError, api } from "@/api/client";

afterEach(() => vi.restoreAllMocks());

describe("AuthGate", () => {
  it("boots a guest shell without mounting private product content", async () => {
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));
    const login = vi.spyOn(api.auth, "login").mockImplementation(() => undefined);

    render(<AuthGate><div>Private dashboard</div></AuthGate>);

    expect(await screen.findByRole("heading", { name: "Follow the founder journey" })).toBeInTheDocument();
    expect(screen.queryByText("Private dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText(/you.?re signed out/i)).not.toBeInTheDocument();
    expect(api.auth.session).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with email code" }));
    expect(login).toHaveBeenNthCalledWith(1, "google");
    expect(login).toHaveBeenNthCalledWith(2, "email");
  });

  it("uses the existing phone drawer pattern for Guest navigation", async () => {
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));
    const { container } = render(<AuthGate><div>Private dashboard</div></AuthGate>);

    await screen.findByRole("heading", { name: "Follow the founder journey" });
    const sidebar = () => container.querySelector(".hra-sidebar");
    expect(sidebar()).toHaveAttribute("data-tier", "phone");
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });
});
