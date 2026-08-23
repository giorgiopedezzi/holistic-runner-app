/**
 * MetricRow.test.tsx  (HRA-75)
 * Pins the two independent toggle behaviours (line/card) through the
 * state+onToggle contract, and that the card checkbox only renders once the
 * metric is active. The "Axis" checkbox this once also covered is gone
 * (dashboard design-system rework, "reorganize activity layout" — per-metric
 * axis visibility is now a hardcoded rule, not a user toggle, see
 * ActivityChartSection.tsx).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricRow } from "./MetricRow";

describe("MetricRow", () => {
  it("hides the card checkbox while the metric is inactive", () => {
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: false, available: true, cardOn: false }} onToggle={vi.fn()} />);

    expect(screen.queryByText("Card")).not.toBeInTheDocument();
  });

  it("clicking the pill fires onToggle('active') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: false, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Heart rate" }));

    expect(onToggle).toHaveBeenCalledWith("active");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggling the Card checkbox fires onToggle('card') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: true, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText("Card"));

    expect(onToggle).toHaveBeenCalledWith("card");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the pill and explains why when the metric has no data", () => {
    render(<MetricRow mKey="power" label="Power"
      state={{ active: false, available: false, cardOn: false }} onToggle={vi.fn()} />);

    const btn = screen.getByRole("button", { name: "Power" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "No data for this metric");
  });
});
