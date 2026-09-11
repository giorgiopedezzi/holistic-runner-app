/**
 * MobileRacePlanCreation.test.tsx (HRA-302)
 * Mounted standalone, same pattern MobileWorkoutSwap.test.tsx/
 * MobileWorkoutEditor.test.tsx already use.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MobileRacePlanCreation } from "./MobileRacePlanCreation";
import { installFetch, json } from "@/test/api-stub";
import { planTemplate } from "@/test/fixtures";
import type { RunPlan } from "@/types/runplan";

function oneWeekPlan(): RunPlan {
  return {
    metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: { RG: { kind: "absolute", pace_sec_per_km: 300 } } },
    sections: [
      {
        name: "Base", week_spec: "1", pace_policy: {}, raw_dsl: "",
        weeks: [
          {
            number: 1, pace_policy: {}, raw_dsl: "",
            days: [
              {
                day: 1, workout_type: "run", needs_review: false, raw_dsl: "D1: 5km @ RG", warnings: [],
                segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }],
              },
              {
                day: 2, workout_type: "rest", needs_review: false, raw_dsl: "D2: REST", warnings: [],
                segments: [{ type: "rest_block", target: { kind: "unknown", raw: "" }, raw: "REST" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function templateWithPlan() {
  return planTemplate({ parsed_plan: JSON.stringify(oneWeekPlan()) });
}

describe("MobileRacePlanCreation", () => {
  it("shows a desktop-required explanation for an ineligible template, with no goal-time input", async () => {
    installFetch({
      "GET /api/v1/plan-templates/1/mobile-eligibility": json({ eligible: false, race_pace_anchor: null, distance_m: 5000, reason: "ambiguous-anchors" }),
    });
    render(<MobileRacePlanCreation template={templateWithPlan()} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText(/advanced setup that isn't available on mobile/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Race name")).not.toBeInTheDocument();
  });

  it("eligible template with a required anchor: fills the form, reviews, and creates without a false success on failure", async () => {
    const mock = installFetch({
      "GET /api/v1/plan-templates/1/mobile-eligibility": json({ eligible: true, race_pace_anchor: "RG", distance_m: 5000, reason: null }),
      "POST /api/v1/plan-templates/1/instantiate/preview": json({
        start_date: "2026-10-09", race_pace_anchor: "RG", resolved_paces: { RG: 300 }, needs_review: false,
      }),
      "POST /api/v1/plan-templates/1/instantiate": () => new Response(JSON.stringify({ detail: "boom" }), { status: 500, headers: { "Content-Type": "application/problem+json" } }),
    });
    const onCreated = vi.fn();
    render(<MobileRacePlanCreation template={templateWithPlan()} onClose={vi.fn()} onCreated={onCreated} />);

    await screen.findByLabelText("Race name");
    fireEvent.change(screen.getByLabelText("Race name"), { target: { value: "My Race" } });
    fireEvent.change(screen.getByLabelText("Race date"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("Goal time (HH:MM:SS)"), { target: { value: "00:25:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("2026-10-09")).toBeInTheDocument();
    expect(screen.getByText(/RG 5:00min\/km/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/plan-templates/1/instantiate"),
      expect.objectContaining({ method: "POST" }),
    ));
    // A failed Create must never claim success: onCreated is never called and
    // the review step's own data (start date, paces) stays exactly as it was.
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByText("2026-10-09")).toBeInTheDocument();
  });

  it("eligible template with no required anchor never shows a goal-time input", async () => {
    installFetch({
      "GET /api/v1/plan-templates/1/mobile-eligibility": json({ eligible: true, race_pace_anchor: null, distance_m: 5000, reason: "already-resolved" }),
    });
    render(<MobileRacePlanCreation template={templateWithPlan()} onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByLabelText("Race name");
    expect(screen.queryByLabelText("Goal time (HH:MM:SS)")).not.toBeInTheDocument();
  });
});
