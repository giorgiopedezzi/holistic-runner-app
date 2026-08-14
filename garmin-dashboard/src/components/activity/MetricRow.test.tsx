/**
 * MetricRow.test.tsx  (HRA-75)
 * Pins the three independent toggle behaviours (line/axis/card) through the
 * new state+onToggle contract (replacing 4 booleans + 3 parallel callbacks),
 * and that the axis/card checkboxes only render once the metric is active.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MetricRow } from "./MetricRow";

describe("MetricRow", () => {
  it("hides the axis/card checkboxes while the metric is inactive", () => {
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: false, available: true, axisOn: false, cardOn: false }} onToggle={vi.fn()} />);

    expect(screen.queryByText("Axis")).not.toBeInTheDocument();
    expect(screen.queryByText("Card")).not.toBeInTheDocument();
  });

  it("clicking the pill fires onToggle('active') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: false, available: true, axisOn: false, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "Heart rate" }));

    expect(onToggle).toHaveBeenCalledWith("active");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggling the Axis checkbox fires onToggle('axis') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: true, available: true, axisOn: true, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText("Axis"));

    expect(onToggle).toHaveBeenCalledWith("axis");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggling the Card checkbox fires onToggle('card') only", () => {
    const onToggle = vi.fn();
    render(<MetricRow mKey="heart_rate" label="Heart rate"
      state={{ active: true, available: true, axisOn: false, cardOn: false }} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText("Card"));

    expect(onToggle).toHaveBeenCalledWith("card");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the pill and explains why when the metric has no data", () => {
    render(<MetricRow mKey="power" label="Power"
      state={{ active: false, available: false, axisOn: false, cardOn: false }} onToggle={vi.fn()} />);

    const btn = screen.getByRole("button", { name: "Power" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "No data for this metric");
  });
});
