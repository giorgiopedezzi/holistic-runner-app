/**
 * shared.test.ts  (HRA-75)
 * Pins the AXIS_SIDE invariant this chart's history keeps regressing on (see
 * docs/frontend.md's "Activity detail chart" notes): Speed/Pace sits alone
 * on the left, every optional metric on the right, under every toggle
 * combination. ActivityChartSection binds `orientation={AXIS_SIDE[key]}`
 * directly with no conditional override, so pinning the constant itself
 * pins the invariant for every possible toggle state — no need to render
 * the chart under every combination to prove it holds.
 */
import { describe, it, expect } from "vitest";
import { AXIS_SIDE, OPTIONAL_METRIC_ORDER } from "./shared";

describe("AXIS_SIDE", () => {
  it("keeps Speed/Pace alone on the left", () => {
    expect(AXIS_SIDE.speed).toBe("left");
  });

  it("puts every optional metric on the right, never sharing Speed's side", () => {
    for (const key of OPTIONAL_METRIC_ORDER) {
      expect(AXIS_SIDE[key]).toBe("right");
    }
  });
});
