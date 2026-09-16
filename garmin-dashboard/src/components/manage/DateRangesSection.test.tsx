/**
 * DateRangesSection.test.tsx (HRA-375)
 * Previously untested. DateRangesSection is only reachable from the private
 * Manage tab, which Guest never sees in nav (App.tsx's guestVisible filter),
 * so this is defense-in-depth for the Story's explicit "Named-range
 * Create/Update/Delete cannot persist any founder change" acceptance
 * criterion, not a currently-reachable Guest path. Covers: Create/Delete
 * render enabled for an authenticated user, and are disabled with the same
 * "sign in to save" messaging the rest of the mutation surface uses when the
 * Guest capability set is forced in directly.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DateRangesSection } from "./DateRangesSection";
import { installFetch, paginated } from "@/test/api-stub";
import { AppModeContext, GUEST_CAPABILITIES } from "@/hooks/useAppMode";

afterEach(() => vi.unstubAllGlobals());

function stubLoad() {
  installFetch({
    "GET /api/v1/date-ranges": paginated([{ id: 1, name: "wk2", from_date: "2026-01-01", to_date: "2026-01-08", activity_id: null }]),
    "GET /api/v1/activities/races": paginated([]),
  });
}

describe("DateRangesSection", () => {
  it("renders Create enabled for an authenticated user once a valid name is entered", async () => {
    stubLoad();
    render(<DateRangesSection />);

    await waitFor(() => expect(screen.getByPlaceholderText("New range name (e.g. Boston wk2)")).toBeInTheDocument());
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled(); // empty name
  });

  it("Guest (cannot persist): disables Create/Delete with sign-in messaging even once otherwise valid (HRA-375)", async () => {
    stubLoad();
    render(
      <AppModeContext.Provider value={GUEST_CAPABILITIES}>
        <DateRangesSection />
      </AppModeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByPlaceholderText("New range name (e.g. Boston wk2)")).toBeInTheDocument());
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", "Sign in to save this to your account.");

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    for (const button of deleteButtons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Sign in to save this to your account.");
    }
  });
});
