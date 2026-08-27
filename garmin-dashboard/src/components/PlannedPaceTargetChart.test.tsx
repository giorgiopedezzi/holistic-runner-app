import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPaceTargetBandModel } from "@/domain/planned-workout";
import { PlannedPaceTargetChart } from "./PlannedPaceTargetChart";

describe("PlannedPaceTargetChart", () => {
  it("is visible when the resolved workout contains plottable target-band data", () => {
    const model = buildPaceTargetBandModel([{
      type: "continuous",
      target: { kind: "distance", distance_m: 5000, raw: "5km" },
      resolved_pace_sec_per_km: 300,
      raw: "5km @ 5:00/km",
    }]);

    render(<PlannedPaceTargetChart model={model} />);

    expect(screen.getByRole("img", { name: "Planned pace targets" })).toBeInTheDocument();
    expect(screen.getByTestId("planned-pace-target-chart")).toHaveTextContent("Planned pace targets");
  });

  it("does not render a chart when the model contains gaps only", () => {
    const model = buildPaceTargetBandModel([{
      type: "rest_block",
      target: { kind: "distance", distance_m: 500, raw: "500m" },
      rest_type: "walk",
      raw: "500m walk",
    }]);

    const { container } = render(<PlannedPaceTargetChart model={model} />);
    expect(container).toBeEmptyDOMElement();
  });
});
