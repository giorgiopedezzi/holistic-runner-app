/**
 * PauseFlagShape.test.tsx  (HRA-293, revised HRA-303)
 * HRA-303 section 8: pause markers must never permanently render a
 * duration pill ("Do not permanently render every pause or recovery value
 * as a pill above the line") — the actual duration is revealed on
 * hover/tap instead (RunnerReadout / TrackTooltip), not baked into the SVG.
 * This now pins: no row ever renders text/rect, an isolated pause and a
 * cluster's anchor member both render exactly one circle, a non-anchor
 * cluster member renders a visibly smaller circle than an anchor (so
 * clustered markers still visually aggregate per the same section's "allow
 * clustered markers to aggregate" requirement).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PauseFlagShape } from "./PauseFlagShape";

// Custom Recharts shapes render bare <g>/<rect>/<circle> — wrap in <svg> so
// they sit under a real SVG ancestor, matching how Recharts itself mounts
// them.
function renderInSvg(el: React.ReactElement) {
  return render(<svg>{el}</svg>);
}

describe("PauseFlagShape", () => {
  it("renders nothing without a pause on this row", () => {
    const { container } = renderInSvg(<PauseFlagShape cx={10} cy={10} payload={{}} />);
    expect(container.querySelector("rect, circle")).toBeNull();
  });

  it("an isolated pause (no cluster fields — desktop, or a mobile pause with no close neighbors) renders one compact marker, never a text pill", () => {
    const { container } = renderInSvg(<PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 125 }} />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's non-anchor member renders a plain dot, no text", () => {
    const { container } = renderInSvg(
      <PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 40, pauseClusterSize: 3, pauseClusterAnchor: 0, pauseClusterTotalSec: 180 }} />,
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's anchor renders one marker, larger than a non-anchor member's, and still no text pill", () => {
    const { container: anchorC } = renderInSvg(
      <PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 60, pauseClusterSize: 3, pauseClusterAnchor: 1, pauseClusterTotalSec: 180 }} />,
    );
    expect(anchorC.querySelectorAll("circle")).toHaveLength(1);
    expect(anchorC.querySelector("rect, text")).toBeNull();
    const anchorRadius = Number(anchorC.querySelector("circle")?.getAttribute("r"));

    const { container: memberC } = renderInSvg(
      <PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 40, pauseClusterSize: 3, pauseClusterAnchor: 0, pauseClusterTotalSec: 180 }} />,
    );
    const memberRadius = Number(memberC.querySelector("circle")?.getAttribute("r"));

    expect(anchorRadius).toBeGreaterThan(memberRadius);
  });
});
