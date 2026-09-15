import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthGate } from "./AuthGate";
import { ApiError, api } from "@/api/client";

afterEach(() => vi.restoreAllMocks());

describe("AuthGate", () => {
  it("offers only the supported interactive sign-in methods", async () => {
    vi.spyOn(api.auth, "session").mockRejectedValue(new ApiError(401, "Authentication is required."));
    const login = vi.spyOn(api.auth, "login").mockImplementation(() => undefined);

    render(<AuthGate><div>Private dashboard</div></AuthGate>);

    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with email code" }));

    expect(login).toHaveBeenNthCalledWith(1, "google");
    expect(login).toHaveBeenNthCalledWith(2, "email");
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByText(/you.?re signed out/i)).not.toBeInTheDocument();
  });
});
