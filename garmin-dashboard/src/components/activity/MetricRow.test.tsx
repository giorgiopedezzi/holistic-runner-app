/**
 * MetricRow.test.tsx  (HRA-75)
 * Pins the two independent toggle behaviours (line/card) through the
 * state+onToggle contract, and that the card checkbox is always rendered but
 * disabled/forced-unchecked while the metric is inactive (dashboard
 * design-system rework: "card checkbox are always visible, unchecked if
 * metric is not selected to be shown"). The "Axis" checkbox this once also
 * covered is gone (an earlier dashboard design-system rework pass,
 * "reorganize activity layout" — per-metric axis visibility is now a
 * hardcoded rule, not a user toggle, see ActivityChartSection.tsx).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricRow } from "./MetricRow";

describe("MetricRow", () => {
  it("shows the card checkbox disabled and unchecked while the metric is inactive", () => {
    render(<MetricRow color="var(--data-hr)" label="Heart rate"
      state={{ active: false, available: true, cardOn: true }} onToggle={vi.fn()} />);

    const checkbox = screen.getByLabelText("Card");
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });

  it("clicking the pill fires onToggle('active') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow color="var(--data-hr)" label="Heart rate"
      state={{ active: false, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Heart rate" }));

    expect(onToggle).toHaveBeenCalledWith("active");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggling the Card checkbox fires onToggle('card') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow color="var(--data-hr)" label="Heart rate"
      state={{ active: true, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText("Card"));

    expect(onToggle).toHaveBeenCalledWith("card");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the pill and explains why when the metric has no data", () => {
    render(<MetricRow color="#a855f7" label="Power"
      state={{ active: false, available: false, cardOn: false }} onToggle={vi.fn()} />);

    const btn = screen.getByRole("button", { name: "Power" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "No data for this metric");
  });
});
