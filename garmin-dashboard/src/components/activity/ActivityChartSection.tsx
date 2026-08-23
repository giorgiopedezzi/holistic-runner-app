import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Gauge, Heart } from "lucide-react";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  fmtMetricValue, axisDomainMinMax, xTickFormatter, distanceTicks, timeTicks,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import type { TrackPoint } from "@/types/api";
import { fmtKm, fmtPace, fmtSpeed } from "@/utils/fmt";
import { speedUnitLabel, paceUnitLabel } from "@/utils/units";
import { axisStyle, gridStyle, METRIC_DEFS, OPTIONAL_METRIC_ORDER, AXIS_SIDE, SPEED_AXIS_TEXT_COLOR, hrRunnerColor, metricStroke } from "./shared";
import { Label, ChartCard, Checkbox, GraphKpiCard, splitUnit } from "@/components/ui";
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
// The right side ALWAYS reserves this fixed total (dashboard design-system
// rework: "reserve space for the right axis without adding them if not
// required — the chart must never shrink or widen"). Per-metric axis
// visibility is now a hardcoded rule, not a user toggle (see the per-metric
// YAxis rendering below): Heart rate's axis is always shown when HR is
// active, Cadence/Power's never is — so HR is the ONLY metric that can ever
// occupy the right side, and this constant is exactly one axis-width, not
// one per optional metric. The real (only ever 0-or-1) axis width in use
// right now is topped up to this constant via the chart's own `margin.right`
// — never via an extra "spacer" axis with no series bound to it (tried
// once, reverted: Recharts doesn't reserve width for an axis nothing plots
// against, so that axis's `width` was silently a no-op — `margin` is always
// honored, unconditionally, which is why it's used instead).
const RIGHT_AXES_WIDTH = AXIS_WIDTH;
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
  // Distance and the current Speed/Pace value — rendered as GraphKpiCards
  // inside the main chart's own controlsRow (dashboard design-system
  // rework, "reorganize activity layout": "move distance and avg speed/
  // pace inside the graph as in overview"), not as separate StatGrid
  // badges any more.
  distanceM: number | null;
  avgSpeedMs: number | null;
  avgPaceMinKm: number | null;
  avgHr: number | null;
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
  showCard: Record<MetricKey, boolean>;
  toggleMetric: (key: OptionalMetricKey) => void;
  toggleCard: (key: MetricKey) => void;
}

export function ActivityChartSection({
  distanceM, avgSpeedMs, avgPaceMinKm, avgHr,
  displayTrack, chartData, hrRecoveryChartData,
  xMode, setXMode, pauseThreshold, setPauseThreshold, removeOutliers, setRemoveOutliers,
  speedMode, setSpeedMode, speedDomain,
  activeMetrics, effectiveActive, availableMetrics, showCard,
  toggleMetric, toggleCard,
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
  // Hover-highlight overlay (dashboard design-system rework, "hover flash
  // effect" — a smooth highlight transition, not a literal flash): same
  // imperative-ref pattern as RunnerIcon above, for the same reason — a
  // mousemove-driven setState here would re-render the whole chart. Purely
  // visual (CSS `--hover-x` position + a `data-active` toggle); never
  // touches the Line's own data-driven colors.
  const hoverDimRef = useRef<HTMLDivElement>(null);
  const hoverGlowRef = useRef<HTMLDivElement>(null);
  function setHoverHighlight(cx: number | null) {
    for (const ref of [hoverDimRef, hoverGlowRef]) {
      const el = ref.current;
      if (!el) continue;
      if (cx == null) {
        el.dataset.active = "false";
      } else {
        el.style.setProperty("--hover-x", `${cx}px`);
        el.dataset.active = "true";
      }
    }
  }

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
    setHoverHighlight(cx);
  }
  function handleChartMouseLeave() {
    if (playStatus === "playing") return;
    showIdleStand(chartData[0]?.x ?? 0);
    runnerReadoutRef.current?.hide();
    setHoverHighlight(null);
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
    playCtxRef.current = { chartData, rowDynamics, plotWidth, leftInset: MARGIN_LEFT + AXIS_WIDTH, rightInset: MARGIN_RIGHT + RIGHT_AXES_WIDTH };
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
    const domainMin = chartData[0].x, domainMax = chartData[chartData.length - 1].x;
    return chartData.map(row =>
      xToPixel(row.x, domainMin, domainMax, plotWidth, MARGIN_LEFT + AXIS_WIDTH, MARGIN_RIGHT + RIGHT_AXES_WIDTH));
  }, [plotWidth, chartData]);

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

  const distanceKm = splitUnit(fmtKm(distanceM));
  const speedPaceKpi = speedMode === "speed"
    ? { value: fmtSpeed(avgSpeedMs), unit: speedUnitLabel(), label: t("activity.metric.speedLabel", "Speed") }
    : { value: fmtPace(avgPaceMinKm), unit: paceUnitLabel(), label: t("activity.metric.paceLabel", "Pace") };


  // Explicit round tick positions — km/mi in distance mode ("8 to 10 labels,
  // at a perfect km"), 5/10/15-minute marks in time mode ("meaningful
  // interval... depending on the moving time"), dashboard design-system
  // rework. Shared by the main chart and every standalone card below so
  // tick placement matches across all of them, not just their widths.
  const xTicks = useMemo(
    () => (xMode === "distance" ? distanceTicks(chartData) : timeTicks(chartData)),
    [xMode, chartData],
  );

  // Heart rate is the only optional metric that can ever show a Y-axis
  // (Cadence/Power never do — see the per-metric YAxis rendering below), so
  // it's the only thing that ever needs real right-side width. `margin.right`
  // tops up whatever's left of RIGHT_AXES_WIDTH so the main chart's total
  // right-side reservation is always the same constant, whether HR is
  // active or not (dashboard design-system rework: "the chart must never
  // shrink or widen").
  const hrAxisShown = activeMetrics.includes("heart_rate");
  const mainChartRightMargin = MARGIN_RIGHT + (hrAxisShown ? 0 : RIGHT_AXES_WIDTH);

  return (
    <div style={{ marginTop: 24 }}>
      {/* One row of selectors (dashboard design-system rework, "reorganize
          activity layout") — Distance/Time and Speed/Pace switches, the
          pause-threshold input, the outlier checkbox, AND the Heart
          rate/Cadence/Power toggles all share one row now: dropping the
          per-metric "Axis" checkbox (see MetricRow.tsx) freed up enough
          room to fold what used to be a separate row into this one. */}
      <div className="hra-control-row" style={{ gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="hra-segment">
          {(["distance", "time"] as XMode[]).map(m => (
            <button key={m} onClick={() => setXMode(m)}
              className="hra-segment-item" data-active={xMode === m}>
              {m === "distance" ? t("activity.chart.distance", "Distance") : t("activity.chart.time", "Time")}
            </button>
          ))}
        </div>
        {/* Speed/Pace: always active, axis always visible (mandatory
            metric — no on/off toggle, unlike the optional metrics below).
            Tinted to the metric's own color via --segment-color rather
            than the app accent — the one switch app-wide with a
            per-instance tint. */}
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
        {OPTIONAL_METRIC_ORDER.map(key => (
          <MetricRow
            key={key}
            mKey={key}
            label={t(`activity.metric.${key}`, METRIC_DEFS[key].label)}
            state={{
              active:    activeMetrics.includes(key),
              available: availableMetrics[key],
              cardOn:    showCard[key],
            }}
            onToggle={field => {
              if (field === "active") toggleMetric(key);
              else toggleCard(key);
            }}
          />
        ))}
      </div>

      {/* Play/Stop moved inside the graph's own controlsRow (dashboard
          design-system rework) — pinned left, badges pinned right via
          justify-content: space-between, so the badge group stays
          right-aligned as a unit regardless of how many badges it holds. */}
      <ChartCard controlsRow={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RunnerPlayButton status={playStatus} onClick={handlePlayClick} />
            <RunnerStopButton disabled={!stopEnabled} onClick={handleStopClick} />
          </div>
          <div className="hra-row-wrap" style={{ gap: 8, justifyContent: "flex-end" }}>
            <GraphKpiCard icon={<MapPin size={16} />} iconColor="var(--accent)"
              value={distanceKm.main} unit={distanceKm.unit} label={t("activity.stat.distance", "Distance")} />
            <GraphKpiCard icon={<Gauge size={16} />} iconColor="var(--accent)"
              value={speedPaceKpi.value} unit={speedPaceKpi.unit} label={speedPaceKpi.label} />
            {avgHr != null && (
              <GraphKpiCard icon={<Heart size={16} color={hrRunnerColor(avgHr)} />} iconColor={hrRunnerColor(avgHr)}
                valueColor={hrRunnerColor(avgHr)} value={`${avgHr}`} unit="bpm" label={t("activity.stat.avgHr", "Avg HR")} />
            )}
          </div>
        </div>
      }>
      {/* The runner row: terrain silhouette + the roaming glyph. Same width
          as the chart below it (both direct children of ChartCard, same
          padding context), so RunnerIcon's `cx` — a pixel offset from
          Recharts' own activeCoordinate (mouse) or the replicated
          axis-layout math (autoplay) — lines up between the two without
          extra translation. Play/Stop now live in the controlsRow above
          (see ChartCard's controlsRow prop) — this row is the runner's
          alone, since the runner also rides the altitude profile at 1m =
          1px and needs the row's full reserved travel
          (RUNNER_ELEVATION_MAX_PX either side of its center) without a
          glyph clipping at a summit or a valley. */}
      <div style={{ position: "relative", height: RUNNER_ROW_HEIGHT, marginBottom: 4 }}>
        <RunnerTerrain dynamics={rowDynamics} xs={terrainXs} height={RUNNER_ROW_HEIGHT} />
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
          data={chartData} margin={{ top: 16, right: mainChartRightMargin, bottom: 5, left: 5 }}
          onMouseMove={handleChartMouseMove} onMouseLeave={handleChartMouseLeave}
        >
          {/* Speed/Pace and HR are drawn with value-mapped gradients rather
              than a flat stroke — see MetricGradient.tsx. The overlay
              chart's speed axis is reversed in pace mode, so faster is at
              the top in both modes here. */}
          <MetricGradientDefs id="overlay" rows={chartData} speedFastAtTop fasterIsHigherValue={speedMode === "speed"} />
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={xTicks}
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
          {/* Optional metrics' axes — all on the right (AXIS_SIDE), never
              sharing Speed's side on the left. Only rendered for metrics
              that are actually active (a Line still needs a scale to bind
              to, even one that never shows). Per-metric axis VISIBILITY is
              now a hardcoded rule, not a user toggle: Heart rate's axis is
              always shown while HR is active; Cadence/Power's is never
              shown, full stop — see MetricRow.tsx (the "Axis" checkbox is
              gone) and mainChartRightMargin above (which is what actually
              keeps the total right-side width constant, not this axis's
              own width toggling). */}
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
      {/* Hover-highlight overlay — two plain CSS layers on top of the SVG,
          not part of it, so the chart's own data-driven colors are never
          touched. Position tracks the cursor via --hover-x, set
          imperatively in handleChartMouseMove/Leave above (see
          setHoverHighlight) — no React re-render per mouse event. */}
      <div ref={hoverDimRef} className="hra-chart-hover-dim" data-active="false" />
      <div ref={hoverGlowRef} className="hra-chart-hover-glow" data-active="false" />
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
              {/* right: a fixed constant, not a spacer axis — a standalone
                  card never has a real right-side axis of its own (always
                  exactly one "main" axis, on the left), so its right margin
                  can just BE the same total the main chart always reserves
                  (RIGHT_AXES_WIDTH), matching it unconditionally. This is
                  `margin`, not an extra hidden YAxis with no series bound to
                  it — that was tried once and reverted (see
                  RIGHT_AXES_WIDTH's own comment): Recharts doesn't reserve
                  width for an axis nothing plots against, so `margin` is
                  what's actually honored. */}
              <ComposedChart data={cardData} margin={{ top: 16, right: MARGIN_RIGHT + RIGHT_AXES_WIDTH, bottom: 5, left: 5 }}>
                {/* Own gradient ids per card — one <svg> each, and a
                    url(#…) may not reach across them. Unlike the overlay
                    chart, this axis is never reversed, so in pace mode the
                    faster (lower) values sit at the BOTTOM. */}
                <MetricGradientDefs id={`card-${key}`} rows={cardData} speedFastAtTop={speedMode === "speed"}
                  fasterIsHigherValue={speedMode === "speed"} />
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} ticks={xTicks}
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
