/**
 * ActivityModal.test.tsx  (HRA-67)
 * ActivityDetailBody — the detail content shared by the accordion and the
 * popup. Covers the loading→content transition, the soft-delete confirm flow
 * (DELETE + onDelete callback), and the error state. Uses a ≤5-point track so
 * the >5-point chart is skipped and assertions stay on the stat grid.
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

    // Stat now splits "10.00 km" into a value div + a smaller inline unit
    // span (polish pass, ui/Stat.tsx's splitUnit) — match on the div's full
    // textContent rather than a single text node.
    const byExactDivText = (text: string) => (_: string, node: Element | null) =>
      node?.tagName.toLowerCase() === "div" && node.textContent === text;
    expect(await screen.findByText(byExactDivText("10.00 km"))).toBeInTheDocument();
    expect(screen.getByText(byExactDivText("152 bpm"))).toBeInTheDocument(); // Avg HR
  });

  it("soft-deletes on confirm and calls onDelete with the id", async () => {
    const onDelete = vi.fn();
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}`]: json({ deleted: 1 }),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={onDelete} />);

    fireEvent.click(await screen.findByRole("button", { name: /Delete activity/i }));
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
