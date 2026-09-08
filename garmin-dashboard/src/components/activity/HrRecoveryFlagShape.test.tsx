/**
 * HrRecoveryFlagShape.test.tsx  (HRA-293)
 * Mirrors PauseFlagShape.test.tsx's cluster coverage for the HR-recovery
 * flags on the standalone Heart rate card.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HrRecoveryFlagShape } from "./HrRecoveryFlagShape";

function renderInSvg(el: React.ReactElement) {
  return render(<svg>{el}</svg>);
}

describe("HrRecoveryFlagShape", () => {
  it("renders nothing without a recovery delta on this row", () => {
    const { container } = renderInSvg(<HrRecoveryFlagShape cx={10} cy={10} payload={{}} />);
    expect(container.querySelector("rect, circle")).toBeNull();
  });

  it("an isolated flag (no cluster fields) renders its own labeled pill", () => {
    const { container } = renderInSvg(<HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 40 }} />);
    expect(container.querySelector("rect")).not.toBeNull();
    expect(container.querySelector("text")?.textContent).toBe("−40 bpm");
  });

  it("a cluster's non-anchor member renders a plain dot, no text", () => {
    const { container } = renderInSvg(
      <HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 20, hrRecoveryClusterSize: 3, hrRecoveryClusterAnchor: 0, hrRecoveryClusterAvg: 30 }} />,
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's anchor renders one aggregated pill with the average delta", () => {
    const { container } = renderInSvg(
      <HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 20, hrRecoveryClusterSize: 3, hrRecoveryClusterAnchor: 1, hrRecoveryClusterAvg: 30 }} />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelector("text")?.textContent).toBe("3× −30 bpm avg");
  });
});
