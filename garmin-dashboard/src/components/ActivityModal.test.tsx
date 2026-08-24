/**
 * ActivityModal.test.tsx  (HRA-67)
 * ActivityDetailBody — the detail content shared by the accordion and the
 * popup. Covers the loading→content transition, the soft-delete confirm flow
 * (DELETE + onDelete callback), and the error state. Uses a ≤5-point track so
 * the >5-point chart is skipped — assertions stay on the stat grid (Max HR is
 * the one HR badge left there; Avg HR moved inside the graph) plus the
 * "not enough data" message that stands in for the graph (and the
 * Distance/Speed-Pace/Avg HR KPIs that live inside it).
 *
 * Dashboard design-system rework ("keep every information at accordion
 * wrap-up level"): ActivityDetailBody's own header (and its Delete button)
 * now renders ONLY for the popup variant (onClose passed) — the accordion
 * case gets all of this from ActivityRow instead (see ActivityRow.test.tsx
 * for that flow). The soft-delete test below passes onClose to exercise the
 * still-real popup path.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivityDetailBody } from "./ActivityModal";
import { installFetch, json, problem } from "@/test/api-stub";
import { activity, shortTrack, settings, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("ActivityDetailBody", () => {
  it("renders the stat grid once the activity + track load", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    // Stat splits its value into a value div + a smaller inline unit span
    // (ui/Stat.tsx's splitUnit) — match on the div's full textContent rather
    // than a single text node.
    const byExactDivText = (text: string) => (_: string, node: Element | null) =>
      node?.tagName.toLowerCase() === "div" && node.textContent === text;
    expect(await screen.findByText(byExactDivText("171 bpm"))).toBeInTheDocument(); // Max HR
    // Distance/Speed-Pace/Avg HR moved inside the graph (dashboard
    // design-system rework) — shortTrack() is ≤5 points, so the graph
    // itself is skipped and this "not enough data" message is the one
    // place that stands in for them, not a StatGrid value.
    expect(screen.getByText("Not enough track data to plot a chart.")).toBeInTheDocument();
  });

  it("soft-deletes on confirm and calls onDelete with the id", async () => {
    const onDelete = vi.fn();
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}`]: json({ deleted: 1 }),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={onDelete} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Remove activity/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, delete/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ID));
  });

  it("surfaces the API error message when the activity fails to load", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: () => problem(500, "activity load failed"),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    expect(await screen.findByText("activity load failed")).toBeInTheDocument();
  });
});
