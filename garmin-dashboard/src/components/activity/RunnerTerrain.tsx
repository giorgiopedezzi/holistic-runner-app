import { useMemo } from "react";
import type { RunnerDynamics } from "@/domain/runner-dynamics";

// The ground the runner runs on: a faded fill under the same altitude curve
// that drives the runner's own vertical position (rowDynamics' elevationPx),
// so the two can never disagree — one array feeds both. Fills the runner's
// row behind the glyph, which is why it reads as terrain rather than as a
// second altitude chart: the runner is standing on its surface.
//
// Its x mapping mirrors the row's own — the runner row and the chart below
// are both direct children of ChartCard, so a chart pixel offset is a row
// pixel offset (see ActivityChartSection's note on RunnerIcon's `cx`).

// The glyph is centered on its elevation, so its feet land ~7px below that
// (its lowest stroke sits at y≈19 of a 24-unit viewBox drawn 25px tall).
// Dropping the surface by that much puts the runner ON the ground instead of
// knee-deep in it; the extra 3px is a deliberate gap, so the feet clear the
// surface rather than merging into it.
const FOOT_DROP_PX = 7;
const SURFACE_GAP_PX = 3;

const TERRAIN_FADE_ID = "runner-terrain-fade";

interface RunnerTerrainProps {
  dynamics: RunnerDynamics[];
  /** Pixel x for each entry of `dynamics`, same order. */
  xs: number[];
  /** The runner row's height; the curve is measured from its center. */
  height: number;
}

export function RunnerTerrain({ dynamics, xs, height }: RunnerTerrainProps) {
  const path = useMemo(() => {
    if (dynamics.length === 0 || xs.length !== dynamics.length) return null;
    const center = height / 2;
    const surface = dynamics
      .map((d, i) => `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)} ${(center - d.elevationPx + FOOT_DROP_PX + SURFACE_GAP_PX).toFixed(1)}`)
      .join(" ");
    // Close down the right edge, along the bottom, and back up the left.
    return `${surface} L${xs[xs.length - 1].toFixed(1)} ${height} L${xs[0].toFixed(1)} ${height} Z`;
  }, [dynamics, xs, height]);

  if (!path) return null;
  return (
    <svg
      width="100%" height={height} aria-hidden
      className="absolute inset-0 pointer-events-none"
    >
      {/* Solid along the ridge, fading to almost nothing at the row's floor —
          the fill reads as ground the runner stands on rather than as a block
          of color, and whatever the chart shows through the row's lower half
          stays legible. objectBoundingBox units, so the ramp spans the drawn
          shape: its top is the profile's highest point, its bottom the row
          floor. A single fixed id is safe here — one runner row per activity
          detail view, and a second instance would resolve to an identical
          gradient anyway. */}
      <defs>
        <linearGradient id={TERRAIN_FADE_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--data-elev)" stopOpacity={0.75} />
          <stop offset="100%" stopColor="var(--data-elev)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={path} fill={`url(#${TERRAIN_FADE_ID})`} />
    </svg>
  );
}
