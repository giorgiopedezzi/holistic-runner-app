import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  fmtMetricValue, axisDomainMinMax, xTickFormatter,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import type { TrackPoint } from "@/types/api";
import { speedUnitLabel } from "@/utils/units";
import { axisStyle, gridStyle, METRIC_DEFS, OPTIONAL_METRIC_ORDER, AXIS_SIDE, SPEED_AXIS_TEXT_COLOR, hrRunnerColor, metricStroke } from "./shared";
import { Label, ChartCard, Checkbox } from "@/components/ui";
import { MetricRow } from "./MetricRow";
import { TrackTooltip } from "./TrackTooltip";
import { PauseFlagShape } from "./PauseFlagShape";
import { HrRecoveryFlagShape } from "./HrRecoveryFlagShape";
import { MetricGradientDefs } from "./MetricGradient";
import { RunnerTerrain } from "./RunnerTerrain";
import { RunnerIcon, type RunnerIconHandle } from "./RunnerIcon";
import { RunnerReadout, type RunnerReadoutHandle } from "./RunnerReadout";
import { RunnerPlayButton, RunnerStopButton, type PlayStatus } from "./RunnerPlayButton";
import { nearestHr } from "@/domain/pauses";
import { computeRunnerDynamics, NEUTRAL_DYNAMICS, RUNNER_ELEVATION_MAX_PX, type RunnerDynamics } from "@/domain/runner-dynamics";

const PLAYBACK_DURATION_MS = 30000; // full activity compressed into ~30s
const PAUSE_DWELL_MS = 4000;        // hold on a pause row before continuing
const AXIS_WIDTH = 42;              // must match the YAxis `width` props below
const MARGIN_LEFT = 5;
const MARGIN_RIGHT = 5;
// Shown standing, before/after any hover or playback (the "beginning and
// end" pose) — the same pale pink hrRunnerColor(80) itself uses for an
// easy 80bpm effort, not a literal/theme color, so it reads identically in
// both themes and matches the resting-HR end of the runner's own color
// scale instead of an arbitrary neutral.
const RUNNER_IDLE_COLOR = hrRunnerColor(80);
// The runner's own row: the band the glyph itself occupies, plus the reserved
// vertical travel for the altitude ride (see domain/runner-dynamics.ts, which
// owns the clamp this is sized from). The glyph band has to clear the 25px
// glyph AND the 5px lift of its pause hop at the very top of the travel —
// 36/2 = 18 against a worst case of 12.5 + 5 — or a summit start clips
// against the row's edge.
const RUNNER_BAND_HEIGHT = 36;
const RUNNER_ROW_HEIGHT = RUNNER_BAND_HEIGHT + 2 * RUNNER_ELEVATION_MAX_PX;

// A chart-domain x to a pixel offset inside the plot area — the chart's own
// axis layout math, replicated (Recharts exposes no scale to read). Shared by
// the autoplay loop and the terrain silhouette so the runner can never stand
// somewhere its ground isn't.
function xToPixel(x: number, domainMin: number, domainMax: number, width: number, leftInset: number, rightInset: number): number {
  const inner = Math.max(0, width - leftInset - rightInset);
  return leftInset + ((x - domainMin) / (domainMax - domainMin || 1)) * inner;
}

// Chart controls + the main multi-metric overlay chart + per-metric
// standalone cards — split out of ActivityDetailBody (HRA-74) to keep both
// files under the 300 LOC cap. Pure move: every prop here is a value/setter
// ActivityDetailBody already computed; no logic changed.
interface ActivityChartSectionProps {
  displayTrack: TrackPoint[];
  chartData: ChartRow[];
  hrRecoveryChartData: (ChartRow & { hrRecoveryDelta?: number })[];
  xMode: XMode; setXMode: (m: XMode) => void;
  pauseThreshold: number; setPauseThreshold: (n: number) => void;
  removeOutliers: boolean; setRemoveOutliers: (b: boolean) => void;
  speedMode: SpeedMode; setSpeedMode: (m: SpeedMode) => void;
  speedDomain: [number, number];
  activeMetrics: OptionalMetricKey[];
  effectiveActive: MetricKey[];
  availableMetrics: Record<MetricKey, boolean>;
  axisVisible: Record<OptionalMetricKey, boolean>;
  showCard: Record<MetricKey, boolean>;
  toggleMetric: (key: OptionalMetricKey) => void;
  toggleAxis: (key: OptionalMetricKey) => void;
  toggleCard: (key: MetricKey) => void;
}

export function ActivityChartSection({
  displayTrack, chartData, hrRecoveryChartData,
  xMode, setXMode, pauseThreshold, setPauseThreshold, removeOutliers, setRemoveOutliers,
  speedMode, setSpeedMode, speedDomain,
  activeMetrics, effectiveActive, availableMetrics, axisVisible, showCard,
  toggleMetric, toggleAxis, toggleCard,
}: ActivityChartSectionProps) {
  const { t } = useTranslation();
  // ── Mouse-follow runner (icon in its own row above the chart, readout
  // pinned below the chart's vertical center) ────────────────────────────
  // Both RunnerIcon and RunnerReadout hold their OWN local hover state,
  // exposed via an imperative handle rather than a prop driven from here —
  // a mousemove-driven setState living in THIS component would re-render
  // the whole ComposedChart (every Line's path, every axis) on every event,
  // which is the exact perf trap an earlier attempt at this feature hit.
  // This way a hover update only ever re-renders the two small components
  // that actually need to change.
  const runnerIconRef = useRef<RunnerIconHandle>(null);
  const runnerReadoutRef = useRef<RunnerReadoutHandle>(null);

  // Plot width for both RunnerReadout's edge math and the autoplay loop's
  // own x-domain→pixel conversion below — measured off the chart's own
  // wrapping div (ResponsiveContainer exposes no size itself).
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setPlotWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function rowColor(row: ChartRow): string {
    const hr = row.heart_rate;
    return typeof hr === "number" ? hrRunnerColor(hr) : "var(--data-hr)";
  }

  // HR right before stopping / right after resuming, for a pause break row
  // — `pauseAfterIndex` is the displayTrack index the pause immediately
  // follows (set by buildChartData), so this walks outward from it exactly
  // like domain/pauses.ts's own computeHrRecovery does for the standalone
  // HR-recovery flags, just resolved on demand for whichever pause row is
  // currently shown instead of precomputed for all of them.
  function pauseHrAt(row: ChartRow): { before: number | null; after: number | null } {
    if (row.pauseAfterIndex == null) return { before: null, after: null };
    return {
      before: nearestHr(displayTrack, row.pauseAfterIndex, -1),
      after: nearestHr(displayTrack, row.pauseAfterIndex + 1, 1),
    };
  }

  // Per-row altitude offset + cumulative moving seconds — the two things the
  // runner's motion is made of (see domain/runner-dynamics.ts).
  const rowDynamics = useMemo<RunnerDynamics[]>(
    () => computeRunnerDynamics(displayTrack, chartData),
    [displayTrack, chartData],
  );

  const [playStatus, setPlayStatus] = useState<PlayStatus>("idle");

  // Hover is simply off while autoplay is running — the two drive the same
  // display and fighting over it (whichever wins on a given frame) reads as
  // broken, not helpful.
  function handleChartMouseMove(state: { activeCoordinate?: { x: number; y: number }; activeTooltipIndex?: number | string | null }) {
    if (playStatus === "playing" || !state?.activeCoordinate) return;
    const rawIdx = state.activeTooltipIndex;
    const idx = typeof rawIdx === "string" ? Number(rawIdx) : rawIdx;
    if (typeof idx !== "number" || Number.isNaN(idx)) return;
    const row = chartData[idx];
    if (!row) return;
    const cx = state.activeCoordinate.x;
    runnerIconRef.current?.show(cx, rowColor(row), row.pauseDurationSec ?? null, false, rowDynamics[idx]);
    runnerReadoutRef.current?.show(row);
  }
  function handleChartMouseLeave() {
    if (playStatus === "playing") return;
    showIdleStand(chartData[0]?.x ?? 0);
    runnerReadoutRef.current?.hide();
  }

  // White, standing — shown at rest (before any hover/play, on mouse-leave,
  // stop, and once autoplay finishes) rather than disappearing entirely, so
  // the chart never reads as "broken" between interactions. `0` as the
  // pause-duration argument reads as a short pause below LONG_PAUSE_SEC, so
  // RunnerIcon renders its plain standing pose (not bent-over).
  function showIdleStand(x: number) {
    runnerIconRef.current?.show(pixelX(x), RUNNER_IDLE_COLOR, 0);
  }

  // ── Autoplay ──────────────────────────────────────────────────────────
  // Drives RunnerIcon/RunnerReadout the same imperative way as the mouse
  // does (see the note above) — via requestAnimationFrame stepping the
  // activity's own MOVING CLOCK (rowDynamics' movingSec), whose row is then
  // converted to a pixel offset by replicating the chart's own axis layout
  // math (its inner plot area = container width minus the fixed left/right
  // axis widths and margins below). Stepping the clock rather than the
  // x-domain is what makes the runner move consistently with pace: in
  // distance mode a uniform x sweep crosses a slow kilometre and a fast one
  // in the same time, which is precisely backwards. This still keeps a 60fps
  // loop from ever re-rendering the ComposedChart: nothing here touches React
  // state past playStatus itself, which only changes at play/pause/finish,
  // not per frame.
  const rafRef = useRef<number | null>(null);
  const clockRef = useRef(0);
  const rowIdxRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const dwellUntilRef = useRef<number | null>(null);
  const lastDwellIdxRef = useRef<number | null>(null);
  // Re-synced every render so a running loop always reads current data/
  // layout, never a stale closure from whichever render scheduled it.
  const playCtxRef = useRef({ chartData, rowDynamics, plotWidth, leftInset: 0, rightInset: 0 });
  useEffect(() => {
    const rightInset = MARGIN_RIGHT + activeMetrics.filter(k => axisVisible[k]).length * AXIS_WIDTH;
    playCtxRef.current = { chartData, rowDynamics, plotWidth, leftInset: MARGIN_LEFT + AXIS_WIDTH, rightInset };
  });
  // Default resting pose, shown as soon as the chart has real geometry to
  // place it at — only while idle, so it doesn't fight a mouse hover or an
  // in-progress/finished play (those set their own runner state directly).
  useEffect(() => {
    if (playStatus !== "idle" || plotWidth === 0 || chartData.length === 0) return;
    showIdleStand(chartData[0].x);
  }, [playStatus, plotWidth, chartData]);

  // Advance the row cursor to wherever the moving clock has reached, and
  // stop the moment it steps ONTO a pause row.
  //
  // A search (binary or otherwise) cannot be used here, and that is the whole
  // point of this function. A pause row shares its movingSec with the point
  // before it — the pause's own gap is excluded from moving time, which is
  // what keeps a long stop from eating the playback — so a value-based lookup
  // has a tie to break and any tie-break that lands on the neighbouring point
  // row skips the pause entirely: the clock crosses that timestamp between
  // two frames and the dwell never fires. Playback only ever moves forward,
  // so walking a cursor visits every row exactly once and cannot step over
  // one.
  function advanceRow(sec: number): { row: ChartRow; idx: number } {
    const { chartData: data, rowDynamics: dyn } = playCtxRef.current;
    let idx = Math.min(rowIdxRef.current, data.length - 1);
    while (idx + 1 < data.length && (dyn[idx + 1]?.movingSec ?? 0) <= sec) {
      idx += 1;
      if (data[idx].pauseDurationSec != null) break; // land on it, don't pass it
    }
    rowIdxRef.current = idx;
    return { row: data[idx], idx };
  }

  function pixelX(x: number): number {
    const { chartData: data, plotWidth: w, leftInset, rightInset } = playCtxRef.current;
    const domainMin = data[0]?.x ?? 0;
    const domainMax = data[data.length - 1]?.x ?? 0;
    return xToPixel(x, domainMin, domainMax, w, leftInset, rightInset);
  }

  // Same conversion as pixelX, but for every row at once and off render-time
  // values rather than playCtxRef (which the effect above only refreshes
  // AFTER this render) — the terrain has to be right on the first paint.
  const terrainXs = useMemo(() => {
    if (plotWidth === 0 || chartData.length === 0) return [];
    const rightInset = MARGIN_RIGHT + activeMetrics.filter(k => axisVisible[k]).length * AXIS_WIDTH;
    const domainMin = chartData[0].x, domainMax = chartData[chartData.length - 1].x;
    return chartData.map(row =>
      xToPixel(row.x, domainMin, domainMax, plotWidth, MARGIN_LEFT + AXIS_WIDTH, rightInset));
  }, [plotWidth, chartData, activeMetrics, axisVisible]);

  function showRow(row: ChartRow, idx: number, dwelling: boolean) {
    const cx = pixelX(row.x);
    const dynamics = playCtxRef.current.rowDynamics[idx] ?? NEUTRAL_DYNAMICS;
    runnerIconRef.current?.show(cx, rowColor(row), row.pauseDurationSec ?? null, dwelling, dynamics);
    runnerReadoutRef.current?.show(row);
  }

  function step(ts: number) {
    if (dwellUntilRef.current != null) {
      if (ts < dwellUntilRef.current) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      dwellUntilRef.current = null;
      lastTsRef.current = ts;
    }
    if (lastTsRef.current == null) lastTsRef.current = ts;
    const dt = ts - lastTsRef.current;
    lastTsRef.current = ts;

    const { chartData: data, rowDynamics: dyn } = playCtxRef.current;
    if (data.length === 0) { setPlayStatus("finished"); rafRef.current = null; return; }
    // The whole activity's moving time, compressed into PLAYBACK_DURATION_MS
    // — so every second of real running gets the same share of the playback,
    // and the runner's speed across the chart is the run's own speed.
    const totalSec = dyn[data.length - 1]?.movingSec ?? 0;
    const rate = totalSec / PLAYBACK_DURATION_MS;
    clockRef.current += dt * rate;

    if (clockRef.current >= totalSec) {
      clockRef.current = totalSec;
      const lastRow = data[data.length - 1];
      showIdleStand(lastRow.x);
      runnerReadoutRef.current?.show(lastRow);
      setPlayStatus("finished");
      rafRef.current = null;
      return;
    }

    const { row, idx } = advanceRow(clockRef.current);
    if (row.pauseDurationSec != null && lastDwellIdxRef.current !== idx) {
      lastDwellIdxRef.current = idx;
      dwellUntilRef.current = ts + PAUSE_DWELL_MS;
      showRow(row, idx, true);
      rafRef.current = requestAnimationFrame(step);
      return;
    }
    showRow(row, idx, false);
    rafRef.current = requestAnimationFrame(step);
  }

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  function handlePlayClick() {
    if (playStatus === "playing") {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      setPlayStatus("paused");
      return;
    }
    if (playStatus === "idle" || playStatus === "finished") {
      clockRef.current = 0;
      rowIdxRef.current = 0;
      lastDwellIdxRef.current = null;
      dwellUntilRef.current = null;
    }
    lastTsRef.current = null;
    setPlayStatus("playing");
    rafRef.current = requestAnimationFrame(step);
  }

  // Enabled whenever a session is actually in progress — "playing" or
  // "paused" both count (a paused run is still a session to stop out of);
  // disabled at "idle"/"finished", where there's nothing running to stop.
  const stopEnabled = playStatus === "playing" || playStatus === "paused";
  function handleStopClick() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
    dwellUntilRef.current = null;
    lastDwellIdxRef.current = null;
    clockRef.current = 0;
    rowIdxRef.current = 0;
    showIdleStand(playCtxRef.current.chartData[0]?.x ?? 0);
    runnerReadoutRef.current?.hide();
    setPlayStatus("idle");
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="hra-control-row" style={{ gap: 16, marginBottom: 12 }}>
        <div className="hra-segment">
          {(["distance", "time"] as XMode[]).map(m => (
            <button key={m} onClick={() => setXMode(m)}
              className="hra-segment-item" data-active={xMode === m}>
              {m === "distance" ? t("activity.chart.distance", "Distance") : t("activity.chart.time", "Time")}
            </button>
          ))}
        </div>
        <label className="hra-text-muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          {t("activity.chart.highlightPauses", "Highlight pauses ≥")}
          <input type="number" min={5} step={5} value={pauseThreshold}
            onChange={e => setPauseThreshold(Math.max(0, Number(e.target.value)))}
            style={{ width: 56, fontSize: 11, padding: "2px 6px" }} />
          sec
        </label>
        <label className="hra-text-muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer" }}
          title={t("activity.chart.removeOutliersTooltip", "Drops isolated bad samples (GPS/sensor noise) from Speed/Pace and Cadence, plus any Speed/Pace sample slower than walking pace — thresholds adjustable in Settings")}>
          <Checkbox size={12} checked={removeOutliers} onCheckedChange={setRemoveOutliers} />
          {t("activity.chart.removeOutliers", "Remove outliers")}
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        {/* Speed/Pace: one column, always active, axis always
            visible (mandatory metric — no on/off toggle, unlike
            the optional metrics below). Tinted to the metric's own
            color via --segment-color rather than the app accent —
            the one switch app-wide with a per-instance tint. */}
        <div className="hra-control-row" style={{ gap: 10, marginBottom: 8 }}>
          <div className="hra-segment" style={{ "--segment-color": METRIC_DEFS.speed.color } as CSSProperties}>
            {(["speed", "pace"] as SpeedMode[]).map(m => (
              <button key={m} onClick={() => setSpeedMode(m)}
                className="hra-segment-item" data-active={speedMode === m}>
                {m === "speed"
                  ? t("activity.chart.speedUnit", `Speed (${speedUnitLabel()})`, { unit: speedUnitLabel() })
                  : t("activity.chart.paceUnit", "Pace (mm:ss)")}
              </button>
            ))}
          </div>
        </div>

        {/* Other metrics: three columns, three per row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: 12 }}>
          {OPTIONAL_METRIC_ORDER.map(key => (
            <MetricRow
              key={key}
              mKey={key}
              label={t(`activity.metric.${key}`, METRIC_DEFS[key].label)}
              state={{
                active:    activeMetrics.includes(key),
                available: availableMetrics[key],
                axisOn:    axisVisible[key],
                cardOn:    showCard[key],
              }}
              onToggle={field => {
                if (field === "active") toggleMetric(key);
                else if (field === "axis") toggleAxis(key);
                else toggleCard(key);
              }}
            />
          ))}
        </div>
      </div>

      <ChartCard>
      {/* A separate row, on top of the chart, inside the card — not an
          overlay floating on the plot. Same width as the chart below it
          (both direct children of ChartCard, same padding context), so
          RunnerIcon's `cx` — a pixel offset from Recharts' own
          activeCoordinate (mouse) or the replicated axis-layout math
          (autoplay) — lines up between the two without extra translation.
          The play/pause/replay + stop controls share this row, pinned to
          the left, while the runner itself roams the rest of the row's
          width — and, since the runner also rides the altitude profile at
          1m = 1px, the row is tall enough to hold that full travel
          (RUNNER_ELEVATION_MAX_PX either side of its center) without the
          glyph clipping at a summit or a valley. The controls stay
          vertically centered, which is exactly the runner's own flat-ground
          height. */}
      <div style={{ position: "relative", height: RUNNER_ROW_HEIGHT, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <RunnerTerrain dynamics={rowDynamics} xs={terrainXs} height={RUNNER_ROW_HEIGHT} />
        {/* Positioned + raised so the controls sit above the terrain fill:
            an absolutely-positioned sibling otherwise paints over in-flow
            content regardless of DOM order. RunnerIcon needs no such wrapper
            — it is itself positioned and comes later. */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          <RunnerPlayButton status={playStatus} onClick={handlePlayClick} />
          <RunnerStopButton disabled={!stopEnabled} onClick={handleStopClick} />
        </div>
        <RunnerIcon ref={runnerIconRef} />
      </div>
      <div ref={plotRef} style={{ position: "relative" }}>
      <RunnerReadout ref={runnerReadoutRef} xMode={xMode} metrics={effectiveActive} speedMode={speedMode} pauseHr={pauseHrAt} />
      <ResponsiveContainer width="100%" height={220}>
        {/* top:16 gives the pause-flag pill (a 14px-tall shape
            centered exactly on the y=1 point at the very top of
            its own [0,1] axis) room to render fully — Recharts'
            default ~5px top margin put half the pill above the
            SVG's own top edge, silently clipping it. */}
        <ComposedChart
          data={chartData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}
          onMouseMove={handleChartMouseMove} onMouseLeave={handleChartMouseLeave}
        >
          {/* Speed/Pace and HR are drawn with value-mapped gradients rather
              than a flat stroke — see MetricGradient.tsx. The overlay
              chart's speed axis is reversed in pace mode, so faster is at
              the top in both modes here. */}
          <MetricGradientDefs id="overlay" rows={chartData} speedFastAtTop fasterIsHigherValue={speedMode === "speed"} />
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
            tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
          {/* Speed/Pace's axis is never conditionally
              hidden/zero-width — it's the one mandatory metric, so
              it must never depend on any toggle state (a previous
              version tied its width to a checkbox's state; that
              checkbox is gone now). It renders on the LEFT, alone —
              every optional metric is on the right (see AXIS_SIDE's
              comment) so Speed never shares a side with anything,
              under any toggle combination. Reversed for pace: lower
              (faster) reads toward the top, matching Speed's own
              "up = faster" feel — on a normal ascending axis,
              pace's inverted units (lower number = faster) would
              make "up" mean speeding up for Speed but slowing down
              for Pace. */}
          <YAxis yAxisId="speed" hide={false} orientation={AXIS_SIDE.speed}
            domain={speedDomain} reversed={speedMode === "pace"}
            tick={{ fill: SPEED_AXIS_TEXT_COLOR, fontSize: 9 }}
            tickFormatter={(v: number) => fmtMetricValue("speed", v, speedMode)}
            width={42} />
          {/* Optional metrics' axes, each independently toggleable
              — all on the right (AXIS_SIDE), never sharing Speed's
              side on the left. */}
          {activeMetrics.map(key => (
            <YAxis key={key} yAxisId={key} hide={!axisVisible[key]} orientation={AXIS_SIDE[key]}
              domain={axisDomainMinMax(displayTrack, key, speedMode)}
              tick={{ fill: METRIC_DEFS[key].color, fontSize: 9 }}
              tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)}
              width={axisVisible[key] ? 42 : 0} />
          ))}
          {effectiveActive.map(key => (
            <Line key={key} yAxisId={key} dataKey={key} stroke={metricStroke(key, "overlay")}
              strokeWidth={1.5} dot={false} isAnimationActive={false} name={METRIC_DEFS[key].label} />
          ))}
          {/* Pause flags get their own fixed, never-reversed,
              hidden [0,1] axis instead of piggybacking on Speed's
              (mean-centered, sometimes-reversed-for-pace) axis —
              an earlier version tried to derive the flags' Y
              position from Speed's domain (domain[1] normally,
              domain[0] when pace's axis is reversed), but that
              still rendered them mid-chart in practice. Plotting
              at a fixed y=1 on a dedicated [0,1] domain removes
              every dependency on Speed's scale/reversal, so the
              flags are guaranteed to sit at the exact top
              regardless of speed/pace mode. Pulls straight off the
              shared chart-level `data` (a dataKey accessor, no
              separate `data` override) so it shares the exact same
              index space as the Line series — a Scatter with its
              own shorter `data` array risked mismatched
              hover/tooltip lookups against them. `width={0}` is
              required despite `hide` — Recharts' YAxis defaults to
              orientation="left"/width=60 when unset, and a hidden
              axis still reserves that width in the left-side axis
              stack, which was silently pushing Speed's real axis
              60px further left than the plot's own left margin —
              off the edge of the container, so it never appeared
              on screen even though it was rendering in the DOM. */}
          <YAxis yAxisId="pauseFlag" domain={[0, 1]} hide width={0} />
          <Scatter
            yAxisId="pauseFlag"
            dataKey={(row: ChartRow) => (row.pauseDurationSec != null ? 1 : null)}
            shape={PauseFlagShape}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      </ChartCard>

      {effectiveActive.filter(key => showCard[key]).map(key => {
        const domain = axisDomainMinMax(displayTrack, key, speedMode);
        // Pause flags render only on the main overlay chart above —
        // repeating them on every standalone card was noise. The
        // one exception is Heart rate, which gets its own
        // recovery-delta flag instead (a different signal: HR drop
        // across the pause, not the pause's duration).
        const cardData = key === "heart_rate" ? hrRecoveryChartData : chartData;
        return (
          <div key={key} style={{ marginTop: 16 }}>
            <Label style={{ marginBottom: 4 }}>
              {key === "speed"
                ? (speedMode === "speed" ? t("activity.metric.speedLabel", "Speed") : t("activity.metric.paceLabel", "Pace"))
                : t(`activity.metric.${key}`, METRIC_DEFS[key].label)}
              {key === "heart_rate" && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{t("activity.chart.hrRecoveryFlagsNote", "flags show HR recovery across each pause")}</span>}
            </Label>
            <ChartCard>
            <ResponsiveContainer width="100%" height={110}>
              {/* Same top-margin fix as the main overlay chart —
                  the HR recovery flag plots at the axis's own max
                  value, which sits at the very top pixel row
                  regardless of the domain's data-space padding. */}
              <ComposedChart data={cardData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}>
                {/* Own gradient ids per card — one <svg> each, and a
                    url(#…) may not reach across them. Unlike the overlay
                    chart, this axis is never reversed, so in pace mode the
                    faster (lower) values sit at the BOTTOM. */}
                <MetricGradientDefs id={`card-${key}`} rows={cardData} speedFastAtTop={speedMode === "speed"}
                  fasterIsHigherValue={speedMode === "speed"} />
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
                  tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
                <YAxis yAxisId="main" domain={domain} tick={axisStyle} tickLine={false} axisLine={false} width={42}
                  tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)} />
                <Tooltip content={<TrackTooltip xMode={xMode} metrics={[key]} speedMode={speedMode} />} />
                <Line yAxisId="main" dataKey={key} stroke={metricStroke(key, `card-${key}`)} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                {key === "heart_rate" && (
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
          </div>
        );
      })}
    </div>
  );
}
