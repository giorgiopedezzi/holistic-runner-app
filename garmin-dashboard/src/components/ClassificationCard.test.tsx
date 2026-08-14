/**
 * ClassificationCard.test.tsx  (HRA-86)
 * Characterization of the workout-classification flows extracted from
 * ActivityModal — previously untested. Behaviour-level: renders the real card
 * through a stateful harness (so onUpdate drives a real re-render), stubs only
 * the classify/feedback endpoints, and asserts on rendered text.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClassificationCard } from "./ClassificationCard";
import { installFetch, json } from "@/test/api-stub";
import { activity, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import type { Activity } from "@/types/api";

const VERDICT_TITLE = "This card's result is the activity's confirmed classification";

// Real update loop: onUpdate = setActivity, mirroring ActivityDetailBody.
function Harness({ initial }: { initial: Activity }) {
  const [a, setA] = useState(initial);
  return <ClassificationCard activity={a} onUpdate={setA} />;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClassificationCard flows", () => {
  it("classify: runs a method and shows its returned result", async () => {
    installFetch({
      [`POST /api/v1/activities/${ID}/classify`]: json(activity({ ai_classification: "Long Session", ai_explanation: "steady aerobic hour" })),
    });
    render(<Harness initial={activity({ ai_classification: null, statistical_classification: null })} />);

    // Two "Classify" buttons (AI + Statistical); AI is first.
    fireEvent.click(screen.getAllByRole("button", { name: "Classify" })[0]);

    expect(await screen.findByText("Long Session")).toBeInTheDocument();
    expect(screen.getByText("steady aerobic hour")).toBeInTheDocument();
  });

  it("approve: thumbs-up confirms this card as the activity's verdict", async () => {
    installFetch({
      [`POST /api/v1/activities/${ID}/feedback`]: json(activity({
        ai_classification: "Long Session", user_feedback: "approved", classification_method: "ai", final_classification: "Long Session",
      })),
    });
    render(<Harness initial={activity({ ai_classification: "Long Session" })} />);

    fireEvent.click(screen.getByRole("button", { name: "👍" }));

    expect(await screen.findByTitle(VERDICT_TITLE)).toBeInTheDocument();
  });

  it("reject-with-reason: thumbs-down → correction → submit posts reason + correction", async () => {
    const fetchMock = installFetch({
      [`POST /api/v1/activities/${ID}/feedback`]: json(activity({
        ai_classification: "Long Session", user_feedback: "rejected", classification_method: "ai",
        final_classification: "Recovery Run", user_correction_reason: "Perception felt harder than numbers",
      })),
    });
    render(<Harness initial={activity({ ai_classification: "Long Session" })} />);

    fireEvent.click(screen.getByRole("button", { name: "👎" }));
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "Perception felt harder than numbers" } });
    fireEvent.change(selects[1], { target: { value: "Recovery Run" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/activities/${ID}/feedback`),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText(/Corrected to: Recovery Run/)).toBeInTheDocument();
  });

  it("reclassify: reflects the server resetting the verdict back to pending", async () => {
    installFetch({
      [`POST /api/v1/activities/${ID}/classify`]: json(activity({
        ai_classification: "Fartlek", user_feedback: null, classification_method: null, final_classification: null,
      })),
    });
    render(<Harness initial={activity({
      ai_classification: "Long Session", user_feedback: "approved", classification_method: "ai", final_classification: "Long Session",
    })} />);

    // Starts confirmed → verdict ✓ present, AI button reads "Reclassify".
    expect(screen.getByTitle(VERDICT_TITLE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reclassify" }));

    expect(await screen.findByText("Fartlek")).toBeInTheDocument();
    // Server reset user_feedback to null → the confirmed indicator is gone.
    expect(screen.queryByTitle(VERDICT_TITLE)).not.toBeInTheDocument();
  });
});
