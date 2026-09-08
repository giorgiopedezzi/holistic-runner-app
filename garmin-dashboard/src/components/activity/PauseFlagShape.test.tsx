/**
 * PauseFlagShape.test.tsx  (HRA-293)
 * Pins the mobile dense-cluster behavior: a cluster's non-anchor members
 * render as a plain dot (no label, no overlap), the anchor renders one
 * aggregated pill for the whole cluster, and an isolated pause (or any
 * point on desktop, where ActivityChartSection never sets cluster fields)
 * renders exactly as before HRA-293 — a single labeled pill.
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

  it("an isolated pause (no cluster fields — desktop, or a mobile pause with no close neighbors) renders its own labeled pill", () => {
    const { container } = renderInSvg(<PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 125 }} />);
    const rect = container.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(container.querySelector("text")?.textContent).toBe("2m5s");
  });

  it("a cluster's non-anchor member renders a plain dot, no text", () => {
    const { container } = renderInSvg(
      <PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 40, pauseClusterSize: 3, pauseClusterAnchor: 0, pauseClusterTotalSec: 180 }} />,
    );
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("a cluster's anchor renders one aggregated pill combining every member's duration", () => {
    const { container } = renderInSvg(
      <PauseFlagShape cx={50} cy={20} payload={{ pauseDurationSec: 60, pauseClusterSize: 3, pauseClusterAnchor: 1, pauseClusterTotalSec: 180 }} />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelector("text")?.textContent).toBe("3× 3m");
  });
});
