import { memo } from "react";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  fmtMetricValue, axisDomainMinMax, xTickFormatter,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import type { TrackPoint } from "@/types/api";
import { ChartCard } from "@/components/ui";
import {
  axisStyle, gridStyle, METRIC_DEFS, AXIS_SIDE, SPEED_AXIS_TEXT_COLOR, metricStroke,
  AXIS_WIDTH, MARGIN_RIGHT, RIGHT_AXES_WIDTH,
} from "./shared";
import { TrackTooltip } from "./TrackTooltip";
import { PauseFlagShape } from "./PauseFlagShape";
import { HrRecoveryFlagShape } from "./HrRecoveryFlagShape";
import { MetricGradientDefs } from "./MetricGradient";

// ── Perf split (playback-lag investigation, dashboard design-system rework)
// ───────────────────────────────────────────────────────────────────────────
// These two components ARE the expensive part of the activity detail chart:
// Recharts regenerating axis scales/line paths for a large track (tens of
// thousands of rows on a marathon) takes multiple seconds — measured against
// a real 14,826-point activity, the pure data pipeline (outlier masks, pause
// detection, buildChartData, runner dynamics) takes ~33ms total, so it was
// never the bottleneck; re-rendering THIS is. ActivityChartSection used to
// inline both of these directly in its own render body, which meant every
// local state change there (Play/Pause, the runner-readiness gate, even
// mouse-hover bookkeeping) re-invoked them too, regardless of whether their
// OWN data changed — nothing was memoized, so React always redid the
// expensive work. Wrapping each in React.memo, with only their own actually-
// relevant props, means ActivityChartSection's unrelated state changes no
// longer force a re-render of them at all: Play/Pause is instant now, not
// "eventually catches up once Recharts finishes."
//
// This only holds as long as every prop below stays referentially stable
// across those unrelated state changes — see ActivityChartSection.tsx's own
// comments on rightMargin (a primitive), onMouseMove/onMouseLeave
// (useCallback'd, reading playStatus via a ref rather than closing over the
// state value directly), and chartData/displayTrack/xTicks/speedDomain (all
// already memoized upstream on data that has nothing to do with playback).

interface MainOverlayChartProps {
  chartData: ChartRow[];
  displayTrack: TrackPoint[];
  xTicks: number[];
  xMode: XMode;
  speedDomain: [number, number];
  speedMode: SpeedMode;
  activeMetrics: OptionalMetricKey[];
  effectiveActive: MetricKey[];
  rightMargin: number;
  onMouseMove: (state: { activeCoordinate?: { x: number; y: number }; activeTooltipIndex?: number | string | null }) => void;
  onMouseLeave: () => void;
}

export const MainOverlayChart = memo(function MainOverlayChart({
  chartData, displayTrack, xTicks, xMode, speedDomain, speedMode, activeMetrics, effectiveActive, rightMargin,
  onMouseMove, onMouseLeave,
}: MainOverlayChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      {/* top:16 gives the pause-flag pill (a 14px-tall shape centered
          exactly on the y=1 point at the very top of its own [0,1] axis)
          room to render fully — Recharts' default ~5px top margin put half
          the pill above the SVG's own top edge, silently clipping it. */}
      <ComposedChart
        data={chartData} margin={{ top: 16, right: rightMargin, bottom: 5, left: 5 }}
        onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
      >
        {/* Speed/Pace and HR are drawn with value-mapped gradients rather
            than a flat stroke — see MetricGradient.tsx. The overlay chart's
            speed axis is reversed in pace mode, so faster is at the top in
            both modes here. */}
        <MetricGradientDefs id="overlay" rows={chartData} speedFastAtTop fasterIsHigherValue={speedMode === "speed"} />
        <CartesianGrid {...gridStyle} />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={xTicks}
          tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
        {/* Speed/Pace's axis is never conditionally hidden/zero-width — it's
            the one mandatory metric, so it must never depend on any toggle
            state. It renders on the LEFT, alone — every optional metric is
            on the right (see AXIS_SIDE's comment) so Speed never shares a
            side with anything, under any toggle combination. Reversed for
            pace: lower (faster) reads toward the top, matching Speed's own
            "up = faster" feel. */}
        <YAxis yAxisId="speed" hide={false} orientation={AXIS_SIDE.speed}
          domain={speedDomain} reversed={speedMode === "pace"}
          tick={{ fill: SPEED_AXIS_TEXT_COLOR, fontSize: 9 }}
          tickFormatter={(v: number) => fmtMetricValue("speed", v, speedMode)}
          width={42} />
        {/* Optional metrics' axes — all on the right (AXIS_SIDE), never
            sharing Speed's side on the left. Only rendered for metrics that
            are actually active (a Line still needs a scale to bind to, even
            one that never shows). Per-metric axis VISIBILITY is a hardcoded
            rule, not a user toggle: Heart rate's axis is always shown while
            HR is active; Cadence/Power's is never shown, full stop — see
            MetricRow.tsx (the "Axis" checkbox is gone) and
            ActivityChartSection's mainChartRightMargin (which is what
            actually keeps the total right-side width constant, not this
            axis's own width toggling). */}
        {activeMetrics.map(key => (
          <YAxis key={key} yAxisId={key} hide={key !== "heart_rate"} orientation={AXIS_SIDE[key]}
            domain={axisDomainMinMax(displayTrack, key, speedMode)}
            tick={{ fill: METRIC_DEFS[key].color, fontSize: 9 }}
            tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)}
            width={key === "heart_rate" ? AXIS_WIDTH : 0} />
        ))}
        {effectiveActive.map(key => (
          <Line key={key} yAxisId={key} dataKey={key} stroke={metricStroke(key, "overlay")}
            strokeWidth={1.5} dot={false} isAnimationActive={false} name={METRIC_DEFS[key].label} />
        ))}
        {/* Pause flags get their own fixed, never-reversed, hidden [0,1]
            axis instead of piggybacking on Speed's (mean-centered,
            sometimes-reversed-for-pace) axis — an earlier version tried to
            derive the flags' Y position from Speed's domain, but that still
            rendered them mid-chart in practice. Plotting at a fixed y=1 on a
            dedicated [0,1] domain removes every dependency on Speed's
            scale/reversal. Pulls straight off the shared chart-level `data`
            so it shares the exact same index space as the Line series.
            `width={0}` is required despite `hide` — Recharts' YAxis
            defaults to orientation="left"/width=60 when unset, and a hidden
            axis still reserves that width in the left-side axis stack. */}
        <YAxis yAxisId="pauseFlag" domain={[0, 1]} hide width={0} />
        <Scatter
          yAxisId="pauseFlag"
          dataKey={(row: ChartRow) => (row.pauseDurationSec != null ? 1 : null)}
          shape={PauseFlagShape}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

interface MetricStandaloneCardProps {
  metricKey: MetricKey;
  cardData: (ChartRow & { hrRecoveryDelta?: number })[];
  domain: [number, number];
  xTicks: number[];
  xMode: XMode;
  speedMode: SpeedMode;
  mainChartData: ChartRow[]; // xTickFormatter needs the main chart's own rows, not this card's (matches pre-split behavior)
}

export const MetricStandaloneCard = memo(function MetricStandaloneCard({
  metricKey, cardData, domain, xTicks, xMode, speedMode, mainChartData,
}: MetricStandaloneCardProps) {
  return (
    <ChartCard>
      <ResponsiveContainer width="100%" height={110}>
        {/* Same top-margin fix as the main overlay chart — the HR recovery
            flag plots at the axis's own max value, which sits at the very
            top pixel row regardless of the domain's data-space padding.
            right: a fixed constant, not a spacer axis — a standalone card
            never has a real right-side axis of its own (always exactly one
            "main" axis, on the left), so its right margin can just BE the
            same total the main chart always reserves (RIGHT_AXES_WIDTH),
            matching it unconditionally. */}
        <ComposedChart data={cardData} margin={{ top: 16, right: MARGIN_RIGHT + RIGHT_AXES_WIDTH, bottom: 5, left: 5 }}>
          {/* Own gradient ids per card — one <svg> each, and a url(#…) may
              not reach across them. Unlike the overlay chart, this axis is
              never reversed, so in pace mode the faster (lower) values sit
              at the BOTTOM. */}
          <MetricGradientDefs id={`card-${metricKey}`} rows={cardData} speedFastAtTop={speedMode === "speed"}
            fasterIsHigherValue={speedMode === "speed"} />
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={xTicks}
            tickFormatter={xTickFormatter(mainChartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
          <YAxis yAxisId="main" domain={domain} tick={axisStyle} tickLine={false} axisLine={false} width={42}
            tickFormatter={(v: number) => fmtMetricValue(metricKey, v, speedMode)} />
          <Tooltip content={<TrackTooltip xMode={xMode} metrics={[metricKey]} speedMode={speedMode} />} />
          <Line yAxisId="main" dataKey={metricKey} stroke={metricStroke(metricKey, `card-${metricKey}`)} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          {metricKey === "heart_rate" && (
            <Scatter
              yAxisId="main"
              dataKey={(row: ChartRow & { hrRecoveryDelta?: number }) => (row.hrRecoveryDelta != null ? domain[1] : null)}
              shape={HrRecoveryFlagShape}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
});
