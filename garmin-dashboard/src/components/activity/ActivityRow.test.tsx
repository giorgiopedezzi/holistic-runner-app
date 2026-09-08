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
 *
 * HRA-280 adds explicit accessibility-tree coverage for the restructuring
 * that replaced the row's own role="button"+stopPropagation pattern (which
 * nested a real <select>/buttons inside a clickable ancestor) with a
 * genuine <button> for the "open detail" action and a non-nested sibling
 * actions area.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivityRow, ActivitySportLegend } from "./ActivityRow";
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

  it("nests no interactive control inside another interactive/clickable ancestor (HRA-280 AC1)", async () => {
    installFetch({ "GET /api/v1/activity-types": paginated([{ id: 1, name: "Race", min_distance_m: 0 }]) });
    const { container } = render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    // Every interactive control in the row (the type select, the
    // Save/Rename trigger, Delete) must have no button/role="button"/select
    // ancestor other than the top-level, non-interactive row container.
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    const interactiveControls = [
      screen.getByRole("combobox"),
      screen.getByRole("button", { name: "Save & name" }),
      screen.getByRole("button", { name: "Remove activity" }),
    ];
    for (const control of interactiveControls) {
      let node = control.parentElement;
      while (node && node !== container) {
        expect(node.tagName.toLowerCase()).not.toBe("button");
        expect(node.getAttribute("role")).not.toBe("button");
        node = node.parentElement;
      }
    }
  });

  it("makes the type select, Save/Rename, and Delete each independently focusable with a distinct accessible name, alongside the row's own open-detail button (HRA-280 AC2)", async () => {
    installFetch({ "GET /api/v1/activity-types": paginated([{ id: 1, name: "Race", min_distance_m: 0 }]) });
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    const openDetail = screen.getByRole("button", { name: /running/ });
    const typeSelect = screen.getByRole("combobox");
    const saveRename = screen.getByRole("button", { name: "Save & name" });
    const remove = screen.getByRole("button", { name: "Remove activity" });

    const accessibleNames = [
      openDetail.getAttribute("aria-label") ?? openDetail.textContent,
      typeSelect.getAttribute("aria-label"),
      saveRename.textContent,
      remove.textContent,
    ];
    expect(new Set(accessibleNames).size).toBe(4);

    for (const control of [openDetail, typeSelect, saveRename, remove]) {
      (control as HTMLElement).focus();
      expect(control).toHaveFocus();
    }
  });
});

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("ActivityRow phone-width overflow menu (HRA-291)", () => {
  it("collapses type change/rename/delete into one overflow menu at phone width, hiding the desktop inline cluster", async () => {
    stubPhoneWidth(true);
    installFetch({ "GET /api/v1/activity-types": paginated([{ id: 1, name: "Race", min_distance_m: 0 }]) });
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "Remove activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Activity actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove activity" })).toBeInTheDocument();
  });

  it("deletes through the overflow menu's ConfirmModal and calls onDelete with the id", async () => {
    stubPhoneWidth(true);
    const onDelete = vi.fn();
    installFetch({
      "GET /api/v1/activity-types": paginated([]),
      [`DELETE /api/v1/activities/${ID}`]: { deleted: 1 },
    });
    render(
      <ActivityRow activity={activity()} expanded={false} expandIndicator="accordion"
        onClick={vi.fn()} onDelete={onDelete} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Activity actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove activity" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ID));
  });
});

describe("ActivitySportLegend", () => {
  it("gives every workout-type color a visible text alternative, not just the swatch (HRA-280 AC3)", () => {
    render(<ActivitySportLegend />);

    const trigger = screen.getByRole("button", { name: "Workout type legend" });
    expect(screen.queryByText("running")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    // Every sport SPORT_COLOR/SPORT_ICON define gets its own entry, each
    // still a Badge (color pill + real text), not a bare colored dot.
    for (const sport of ["running", "walking", "cycling", "swimming", "hiking", "fitness_equipment", "other"]) {
      expect(screen.getByText(sport)).toBeInTheDocument();
    }
  });
});
