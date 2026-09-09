/**
 * HrRecoveryFlagShape.test.tsx  (HRA-293, revised HRA-303)
 * Mirrors PauseFlagShape.test.tsx's revised coverage — see its own header
 * comment. No row ever renders a permanent text pill any more; the actual
 * delta is revealed on hover/tap via TrackTooltip's hrRecoveryDelta branch.
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

  it("an isolated flag (no cluster fields) renders one compact marker, never a text pill", () => {
    const { container } = renderInSvg(<HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 40 }} />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's non-anchor member renders a plain dot, no text", () => {
    const { container } = renderInSvg(
      <HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 20, hrRecoveryClusterSize: 3, hrRecoveryClusterAnchor: 0, hrRecoveryClusterAvg: 30 }} />,
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's anchor renders one marker, larger than a non-anchor member's, and still no text pill", () => {
    const { container: anchorC } = renderInSvg(
      <HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 20, hrRecoveryClusterSize: 3, hrRecoveryClusterAnchor: 1, hrRecoveryClusterAvg: 30 }} />,
    );
    expect(anchorC.querySelectorAll("circle")).toHaveLength(1);
    expect(anchorC.querySelector("rect, text")).toBeNull();
    const anchorRadius = Number(anchorC.querySelector("circle")?.getAttribute("r"));

    const { container: memberC } = renderInSvg(
      <HrRecoveryFlagShape cx={50} cy={20} payload={{ hrRecoveryDelta: 20, hrRecoveryClusterSize: 3, hrRecoveryClusterAnchor: 0, hrRecoveryClusterAvg: 30 }} />,
    );
    const memberRadius = Number(memberC.querySelector("circle")?.getAttribute("r"));

    expect(anchorRadius).toBeGreaterThan(memberRadius);
  });
});
