/**
 * WorkoutAssociationControl.test.tsx (HRA-375)
 * Previously untested — this Story adds Guest (cannot-persist) gating
 * alongside the pre-existing DEMO_MODE gating, so both branches need direct
 * coverage: authenticated renders the Link control enabled, Guest disables
 * it with the same "sign in to save" messaging the rest of the activity
 * mutation surface uses (ActivityRow/ActivityTypePicker/ClassificationCard).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkoutAssociationControl } from "./WorkoutAssociationControl";
import { installFetch, json } from "@/test/api-stub";
import { REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import { AppModeContext, GUEST_CAPABILITIES } from "@/hooks/useAppMode";
import type { AssociationView } from "@/types/api";

afterEach(() => vi.unstubAllGlobals());

function unlinkedAssociation(): AssociationView {
  return {
    activity_id: ID, workout_id: null, status: "manual_changed",
    instance_id: null, instance_name: null, section_name: null, week_number: null, date: null,
  };
}

describe("WorkoutAssociationControl", () => {
  it("renders the Link control enabled for an authenticated user", async () => {
    installFetch({ [`GET /api/v1/activities/${ID}/association`]: json(unlinkedAssociation()) });
    render(<WorkoutAssociationControl activityId={ID} />);

    const link = await screen.findByRole("button", { name: "Link…" });
    expect(link).toBeEnabled();
  });

  it("Guest (cannot persist): disables Link… with sign-in messaging, not a raw protected-API failure (HRA-375)", async () => {
    installFetch({ [`GET /api/v1/activities/${ID}/association`]: json(unlinkedAssociation()) });
    render(
      <AppModeContext.Provider value={GUEST_CAPABILITIES}>
        <WorkoutAssociationControl activityId={ID} />
      </AppModeContext.Provider>,
    );

    const link = await screen.findByRole("button", { name: "Link…" });
    await waitFor(() => expect(link).toBeDisabled());
    expect(link).toHaveAttribute("title", "Sign in to save this to your account.");
  });
});
