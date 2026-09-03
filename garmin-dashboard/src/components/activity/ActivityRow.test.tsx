/**
 * ActivityRow.test.tsx
 * Dashboard design-system rework ("keep every information at accordion
 * wrap-up level") — ActivityRow absorbed everything ActivityDetailBody's own
 * header used to duplicate (via, the ActivityTypePicker, Delete), always
 * visible rather than gated behind expanding a row. Covers: the row renders
 * that consolidated content, the row-level delete flow actually deletes and
 * calls onDelete, and — the one real risk of folding interactive controls
 * into what's otherwise a single clickable row — clicking those controls
 * does NOT also toggle the row's own expand/collapse.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivityRow } from "./ActivityRow";
import { installFetch, paginated } from "@/test/api-stub";
import { activity, settings, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("ActivityRow", () => {
  it("shows sport/date/distance/via on the left and duration/HR/pace on the right", () => {
    installFetch({});
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("10.00 km")).toBeInTheDocument();
    expect(screen.getByText("via Garmin")).toBeInTheDocument();
    expect(screen.getByText("♥ 152")).toBeInTheDocument();
  });

  it("deletes on confirm and calls onDelete with the id", async () => {
    const onDelete = vi.fn();
    installFetch({
      [`DELETE /api/v1/activities/${ID}`]: { deleted: 1 },
    });
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={onDelete} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ID));
  });

  it("renaming through the row's own picker updates the row's displayed name without a refetch", async () => {
    const renamed = { ...activity(), activity_name: "Berlin Marathon" };
    installFetch({
      "GET /api/v1/activity-types": paginated([{ id: 1, name: "Race", min_distance_m: 0 }]),
      [`PUT /api/v1/activities/${ID}/type`]: renamed,
    });
    // Real update loop (mirrors ActivityDetailBody/ClassificationCard.test.tsx):
    // onUpdate re-renders with the fresh Activity a real caller (ActivitiesTab)
    // would fold into its own list state, instead of the no-op this row used
    // to hardcode internally.
    function Harness() {
      const [a, setA] = useState(activity());
      return (
        <ActivityRow activity={a} expanded={false} expandIndicator="accordion"
          onClick={vi.fn()} onDelete={vi.fn()} onUpdate={setA} />
      );
    }
    render(<Harness />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Save & name" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save & name" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Berlin Marathon"), { target: { value: "Berlin Marathon" } });
    // Two "Save & name" elements once the popover's open: the trigger and its
    // own submit button — the submit is the second one in DOM order.
    fireEvent.click(screen.getAllByRole("button", { name: "Save & name" })[1]);

    await waitFor(() => expect(screen.getByText("Berlin Marathon")).toBeInTheDocument());
  });

  it("does not toggle expand/collapse when clicking Delete", () => {
    const onClick = vi.fn();
    installFetch({});
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={onClick} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove activity" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables Remove activity and Save & name when DEMO_MODE is on (HRA-220)", async () => {
    installFetch({
      "GET /api/v1/settings": settings({ demo_mode: true }),
      "GET /api/v1/activity-types": paginated([]),
    });
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Remove activity" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Save & name" })).toBeDisabled();
  });
});
