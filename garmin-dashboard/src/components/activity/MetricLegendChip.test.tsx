/**
 * MetricLegendChip.test.tsx (HRA-292)
 * Pins the two independent toggle behaviours (series chip / detail-chart
 * button) through the state+onToggle contract, mirroring MetricRow.test.tsx's
 * coverage for the pattern this replaces.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricLegendChip } from "./MetricLegendChip";

describe("MetricLegendChip", () => {
  it("shows the detail-chart button disabled and unpressed while the metric is inactive", () => {
    render(<MetricLegendChip color="var(--data-hr)" label="Heart rate"
      state={{ active: false, available: true, cardOn: true }} onToggle={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Heart rate detail chart" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking the chip fires onToggle('active') only", () => {
    const onToggle = vi.fn();
    render(<MetricLegendChip color="var(--data-hr)" label="Heart rate"
      state={{ active: false, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Heart rate" }));

    expect(onToggle).toHaveBeenCalledWith("active");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking the detail-chart button fires onToggle('card') only", () => {
    const onToggle = vi.fn();
    render(<MetricLegendChip color="var(--data-hr)" label="Heart rate"
      state={{ active: true, available: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Heart rate detail chart" }));

    expect(onToggle).toHaveBeenCalledWith("card");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the chip and explains why when the metric has no data", () => {
    render(<MetricLegendChip color="#a855f7" label="Power"
      state={{ active: false, available: false, cardOn: false }} onToggle={vi.fn()} />);

    const chip = screen.getByRole("button", { name: "Power" });
    expect(chip).toBeDisabled();
    expect(chip).toHaveAttribute("title", "No data for this metric");
  });
});
