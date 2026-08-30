import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Gauge, Heart } from "lucide-react";
import {
  axisDomainMinMax, distanceTicks, timeTicks,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import type { PaceTargetBandModel } from "@/domain/planned-workout";
import { PlannedPaceTargetChart } from "@/components/PlannedPaceTargetChart";
import type { PlanInstanceDayWithInstance, TrackPoint } from "@/types/api";
import { fmtKm, fmtPace, fmtSpeed } from "@/utils/fmt";
import { speedUnitLabel, paceUnitLabel } from "@/utils/units";
import { METRIC_DEFS, OPTIONAL_METRIC_ORDER, hrRunnerColor, AXIS_WIDTH, MARGIN_LEFT, MARGIN_RIGHT, RIGHT_AXES_WIDTH } from "./shared";
import { Label, ChartCard, Checkbox, GraphKpiCard, LoadingSpinner, Select, splitUnit } from "@/components/ui";
import { MetricRow } from "./MetricRow";
import { MainOverlayChart, MetricStandaloneCard } from "./OverlayCharts";
import { RunnerTerrain } from "./RunnerTerrain";
import { RunnerIcon, type RunnerIconHandle } from "./RunnerIcon";
import { RunnerReadout, type RunnerReadoutHandle } from "./RunnerReadout";
import { RunnerPlayButton, RunnerStopButton, type PlayStatus } from "./RunnerPlayButton";
import { nearestHr } from "@/domain/pauses";
import { computeRunnerDynamics, NEUTRAL_DYNAMICS, RUNNER_ELEVATION_MAX_PX, type RunnerDynamics } from "@/domain/runner-dynamics";

const PLAYBACK_DURATION_MS = 30000; // full activity compressed into ~30s
const PAUSE_DWELL_MS = 4000;        // hold on a pause row before continuing
// How far the actual plotted line sits from this section's own outer edge,
// on each side: ChartCard's own padding ("16px 8px 8px", see ui/ChartCard.tsx)
// plus this chart's own margin+axis-width inset (AXIS_WIDTH etc., see
// shared.ts). `children` (the terrain row, the plot area) sit directly in
// that 8px — no extra wrapper — so this is their real inset from the card's
// outer edge.
const CHART_CARD_PADDING_X = 8;
const CHART_PLOT_INSET_LEFT = CHART_CARD_PADDING_X + MARGIN_LEFT + AXIS_WIDTH;
const CHART_PLOT_INSET_RIGHT = CHART_CARD_PADDING_X + MARGIN_RIGHT + RIGHT_AXES_WIDTH;
// `controlsRow`, unlike `children` above, gets an EXTRA "0 8px" wrapper div
// of its own on top of the card's padding (ChartCard.tsx) — 16px baseline
// before any padding a caller adds. The row inside this graph card
// (Play/Stop + the Distance/Speed-Pace/Avg HR KPI badges) must span exactly
// the terrain/plotted-line width (dashboard design-system rework: "the row
// INSIDE the graph card must be the same width as the terrain/graph
// lines"), so this is topped up to CHART_PLOT_INSET_LEFT/RIGHT rather than
// reusing those directly.
const CHART_CONTROLS_ROW_BASELINE = 16;
const CHART_HEADER_EXTRA_LEFT = CHART_PLOT_INSET_LEFT - CHART_CONTROLS_ROW_BASELINE;
const CHART_HEADER_EXTRA_RIGHT = CHART_PLOT_INSET_RIGHT - CHART_CONTROLS_ROW_BASELINE;
// MainOverlayChart's own <ResponsiveContainer height={220}> (OverlayCharts.tsx)
// — duplicated here only for sizing the deferred-mount placeholder (see
// chartMounted) to the same total height, so nothing visibly jumps once the
// real runner-row + chart mount a frame later.
const MAIN_CHART_HEIGHT = 220;
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

// Module-level (not a closure) — takes everything it needs as a parameter,
// so its identity never needs to be threaded through a useCallback dependency
// list just to keep handleChartMouseMove's own identity stable (see below).
function rowColor(row: ChartRow): string {
  const hr = row.heart_rate;
  return typeof hr === "number" ? hrRunnerColor(hr) : "var(--data-hr)";
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
  // HRA-208: the selected scheduled workout's pace-target bands (null when no
  // scheduled workout is selected -> no change to this section's rendering),
  // plus the pill+card toggle pair that decides whether it's drawn as an
  // additive layer on the main chart (plannedShown) and/or as its own
  // standalone card, first under the main chart (plannedCardShown) — same
  // active/card toggle shape MetricRow already gives cadence/power.
  plannedModel: PaceTargetBandModel | null;
  plannedShown: boolean; setPlannedShown: (b: boolean) => void;
  plannedCardShown: boolean; setPlannedCardShown: (b: boolean) => void;
  // Same-day scheduled workout candidates (HRA-206) — the picker itself now
  // lives in this section's own middle control column rather than below the
  // whole chart section, so it needs the raw list + selection here too.
  plannedDays: PlanInstanceDayWithInstance[];
  selectedPlannedDayId: number | null; setSelectedPlannedDayId: (id: number) => void;
}

export function ActivityChartSection({
  distanceM, avgSpeedMs, avgPaceMinKm, avgHr,
  displayTrack, chartData, hrRecoveryChartData,
  xMode, setXMode, pauseThreshold, setPauseThreshold, removeOutliers, setRemoveOutliers,
  speedMode, setSpeedMode, speedDomain,
  activeMetrics, effectiveActive, availableMetrics, showCard,
  toggleMetric, toggleCard,
  plannedModel, plannedShown, setPlannedShown, plannedCardShown, setPlannedCardShown,
  plannedDays, selectedPlannedDayId, setSelectedPlannedDayId,
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
  // touches the Line's own data-driven colors. useCallback'd with an empty
  // dependency array (it only ever reads refs, which are stable by
  // definition) so ITS identity never changes either — see the perf-split
  // comment on handleChartMouseMove below for why that matters now.
  const hoverDimRef = useRef<HTMLDivElement>(null);
  const hoverGlowRef = useRef<HTMLDivElement>(null);
  const setHoverHighlight = useCallback((cx: number | null) => {
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
  }, []);

  // Defers MainOverlayChart's very FIRST mount by (at least) one real paint
  // (playback-lag investigation, mount-time half of the same issue): on
  // first mount, <ComposedChart> hasn't rendered even once yet, so there's
  // nothing for React.memo to skip — that first render is unavoidably as
  // expensive as any of the ones memoization now protects Play/Pause from,
  // and bundling it into the SAME commit as ActivityDetailBody's own
  // "loading" flag flipping false meant the "Preparing the runner…" bar
  // below never got a chance to actually PAINT before that heavy work
  // started — it was computed but never shown, same class of bug as the
  // play-click one, just at mount instead of a click.
  //
  // A plain useEffect looked sufficient here (React documents passive
  // effects as running after paint) and even measured as two separate
  // commits in a jsdom test — but jsdom has no real paint/compositor at all,
  // so that only proved React committed the DOM change twice, not that a
  // BROWSER actually painted the first one before starting the second's
  // heavy work; in practice this still produced no visible loading state at
  // all. Nested requestAnimationFrame is the one guarantee that's actually
  // spec-defined rather than a React scheduling heuristic — the exact same
  // fix handlePlayClick already relies on, for the identical reason.
  const [chartMounted, setChartMounted] = useState(false);
  const chartMountRaf2Ref = useRef<number | null>(null);
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      chartMountRaf2Ref.current = requestAnimationFrame(() => setChartMounted(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (chartMountRaf2Ref.current != null) cancelAnimationFrame(chartMountRaf2Ref.current);
    };
  }, []);

  // Plot width for both RunnerReadout's edge math and the autoplay loop's
  // own x-domain→pixel conversion below — measured off the chart's own
  // wrapping div (ResponsiveContainer exposes no size itself). Depends on
  // chartMounted (not `[]`) because plotRef's own div doesn't exist in the
  // DOM until the deferred mount above actually renders it — the first
  // attempt (chartMounted still false) finds plotRef.current null and bails
  // out, same as always; this re-runs once the div is real.
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setPlotWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartMounted]);

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
  // handleChartMouseMove/Leave below are useCallback'd so THEIR identity
  // stays stable across playStatus changes (a stable onMouseMove/onMouseLeave
  // prop is what lets MainOverlayChart's React.memo actually skip re-
  // rendering on Play/Pause — see OverlayCharts.tsx). That means they can't
  // close over the `playStatus` state value directly (closing over it would
  // require listing it as a dependency, which would defeat the point) — a
  // ref mirrors it instead, read at call time.
  const playStatusRef = useRef(playStatus);
  useEffect(() => { playStatusRef.current = playStatus; });

  // Hover is simply off while autoplay is running — the two drive the same
  // display and fighting over it (whichever wins on a given frame) reads as
  // broken, not helpful.
  const handleChartMouseMove = useCallback((state: { activeCoordinate?: { x: number; y: number }; activeTooltipIndex?: number | string | null }) => {
    if (playStatusRef.current === "playing" || !state?.activeCoordinate) return;
    const rawIdx = state.activeTooltipIndex;
    const idx = typeof rawIdx === "string" ? Number(rawIdx) : rawIdx;
    if (typeof idx !== "number" || Number.isNaN(idx)) return;
    const row = chartData[idx];
    if (!row) return;
    const cx = state.activeCoordinate.x;
    runnerIconRef.current?.show(cx, rowColor(row), row.pauseDurationSec ?? null, false, rowDynamics[idx]);
    runnerReadoutRef.current?.show(row);
    setHoverHighlight(cx);
  }, [chartData, rowDynamics, setHoverHighlight]);
  const handleChartMouseLeave = useCallback(() => {
    if (playStatusRef.current === "playing") return;
    showIdleStand(chartData[0]?.x ?? 0, rowDynamics[0]);
    runnerReadoutRef.current?.hide();
    setHoverHighlight(null);
    // showIdleStand/pixelX read playCtxRef (a ref) and take everything else
    // as parameters — they never need to be in this list for correctness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, rowDynamics, setHoverHighlight]);

  // White, standing — shown at rest (before any hover/play, on mouse-leave,
  // stop, and once autoplay finishes) rather than disappearing entirely, so
  // the chart never reads as "broken" between interactions. `0` as the
  // pause-duration argument reads as a short pause below LONG_PAUSE_SEC, so
  // RunnerIcon renders its plain standing pose (not bent-over). `dynamics`
  // must be passed explicitly — RunnerIcon.show() only defaults it to
  // NEUTRAL_DYNAMICS (elevationPx: 0, dead center) when omitted, which is
  // what put the runner in the middle of its row instead of resting on the
  // terrain at a course's actual starting/ending elevation (a course that
  // starts well above its finish, e.g. Boston, made this obvious — every
  // OTHER call site already threads a real dynamics value, this was the one
  // that didn't).
  function showIdleStand(x: number, dynamics: RunnerDynamics = NEUTRAL_DYNAMICS) {
    runnerIconRef.current?.show(pixelX(x), RUNNER_IDLE_COLOR, 0, false, dynamics);
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
  // not per frame — and now that MainOverlayChart is memoized (see
  // OverlayCharts.tsx), even THAT no longer costs a full chart re-render.
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
    showIdleStand(chartData[0].x, rowDynamics[0]);
  }, [playStatus, plotWidth, chartData, rowDynamics]);

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
    // Same hover-dim/glow the real mouse drives (dashboard design-system
    // rework: "while animation plays, use the same effect as hovering,
    // following exactly the runner position") — driven by the runner's own
    // cx instead of a mouse event. Real mouse hover stays disabled during
    // playback (see handleChartMouseMove), so the two never fight.
    setHoverHighlight(cx);
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
      showIdleStand(lastRow.x, dyn[data.length - 1] ?? NEUTRAL_DYNAMICS);
      runnerReadoutRef.current?.show(lastRow);
      setHoverHighlight(null);
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
    showIdleStand(playCtxRef.current.chartData[0]?.x ?? 0, playCtxRef.current.rowDynamics[0] ?? NEUTRAL_DYNAMICS);
    runnerReadoutRef.current?.hide();
    setHoverHighlight(null);
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

  // Per-metric Y-domain for each shown standalone card — memoized (perf
  // split, playback-lag fix) so its ARRAY reference stays stable across
  // renders that don't actually change it. Computing this inline in the
  // render loop below (as `axisDomainMinMax(...)` directly) was exactly what
  // broke MetricStandaloneCard's React.memo: a fresh `domain` array every
  // render is a fresh prop reference every render, which fails memo's
  // shallow comparison even though MainOverlayChart's OWN memo (whose props
  // didn't have this problem) was working correctly — the standalone HR
  // card (shown by default) was the one still re-rendering on every
  // Play/Pause click.
  const cardDomains = useMemo(() => {
    const domains: Partial<Record<MetricKey, [number, number]>> = {};
    for (const key of effectiveActive) {
      if (showCard[key]) domains[key] = axisDomainMinMax(displayTrack, key, speedMode);
    }
    return domains;
  }, [effectiveActive, showCard, displayTrack, speedMode]);

  // Heart rate is the only optional metric that can ever show a Y-axis
  // (Cadence/Power never do — see MainOverlayChart's per-metric YAxis
  // rendering), so it's the only thing that ever needs real right-side
  // width. `margin.right` tops up whatever's left of RIGHT_AXES_WIDTH so the
  // main chart's total right-side reservation is always the same constant,
  // whether HR is active or not (dashboard design-system rework: "the chart
  // must never shrink or widen").
  const hrAxisShown = activeMetrics.includes("heart_rate");
  const mainChartRightMargin = MARGIN_RIGHT + (hrAxisShown ? 0 : RIGHT_AXES_WIDTH);

  // Same condition the idle-stand effect above already gates on — the
  // runner has no real geometry to be placed at until the chart's actual
  // plot width is measured (ResizeObserver, one render behind mount) and
  // chartData itself exists.
  const runnerReady = plotWidth !== 0 && chartData.length > 0;

  // The planned overlay only ever feeds the main chart while the pill is on
  // — same "active" semantics MetricRow gives cadence/power (mirrored below
  // for the planned pill itself), just resolved here since MainOverlayChart
  // takes the model directly rather than the toggle state.
  const plannedOverlay = plannedShown ? plannedModel : null;

  return (
    <div className="hra-activity-chart-section">
      {/* Three-column selector row (dashboard design-system rework,
          "reorganize activity layout"): left = Distance/Time + Speed/Pace
          switches; center = pause-threshold + outlier checkbox; right =
          Heart rate/Cadence/Power toggles, right-aligned to the same edge as
          the badge row above (both are full-width, matching the
          Classification accordion above them — no chart-plot inset here;
          only the controlsRow INSIDE the graph card below gets that, see
          CHART_HEADER_EXTRA_LEFT/RIGHT). A 1fr/auto/1fr grid, not flex —
          centers the middle column independent of how wide the two side
          groups are, which justify-content: space-between can't guarantee
          for a 3-child row. */}
      <div className="hra-activity-chart-selectors grid items-center gap-4">
        <div className="hra-row-wrap gap-4">
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
          <div className="hra-speed-segment hra-segment">
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
        <div className="hra-row-wrap gap-4 justify-center">
          <label className="hra-text-muted flex items-center gap-1.5 text-meta">
            {t("activity.chart.highlightPauses", "Highlight pauses ≥")}
            <input type="number" min={5} step={5} value={pauseThreshold}
              onChange={e => setPauseThreshold(Math.max(0, Number(e.target.value)))}
              className="w-14 text-meta py-0.5 px-1.5" />
            sec
          </label>
          <label className="hra-text-muted flex items-center gap-1.5 text-meta cursor-pointer"
            title={t("activity.chart.removeOutliersTooltip", "Drops isolated bad samples (GPS/sensor noise) from Speed/Pace and Cadence, plus any Speed/Pace sample slower than walking pace — thresholds adjustable in Settings")}>
            <Checkbox size={12} checked={removeOutliers} onCheckedChange={setRemoveOutliers} />
            {t("activity.chart.removeOutliers", "Remove outliers")}
          </label>
        </div>
        <div className="hra-activity-metric-controls hra-row-wrap gap-4 justify-end">
          {OPTIONAL_METRIC_ORDER.map(key => (
            <MetricRow
              key={key}
              color={METRIC_DEFS[key].color}
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
      </div>

      {/* Play/Stop moved inside the graph's own controlsRow (dashboard
          design-system rework) — pinned left, badges pinned right via
          justify-content: space-between, so the badge group stays
          right-aligned as a unit regardless of how many badges it holds.
          Left/right-padded by CHART_HEADER_EXTRA_LEFT/RIGHT so Play/Stop and
          the badge group line up with the terrain/plotted-line width below,
          not just ChartCard's own baseline padding (dashboard design-system
          rework: "the row INSIDE the graph card must be the same width as
          the terrain/graph lines"). */}
      <ChartCard
        controlsRow={
        <div className="hra-activity-chart-controls grid items-center gap-3" style={{
          "--chart-controls-left": `${CHART_HEADER_EXTRA_LEFT}px`,
          "--chart-controls-right": `${CHART_HEADER_EXTRA_RIGHT}px`,
        } as CSSProperties}>
          {/* Left column: Play/Stop only. */}
          <div className="flex items-center gap-1.5">
            <RunnerPlayButton status={playStatus} onClick={handlePlayClick} disabled={!runnerReady} />
            <RunnerStopButton disabled={!stopEnabled} onClick={handleStopClick} />
          </div>
          {/* Middle column: the planned-workout pill + card toggle, the
              Actual/Planned legend while the overlay is actually shown, then
              the same-day scheduled-workout picker when there's more than
              one candidate (explicit feedback: "move Planned pill and legend
              in the middle column"). Pill only rendered once a scheduled
              workout is actually selected (plannedModel resolves) — the
              Overlap/Distinct switch this replaces is gone; the pill IS the
              on/off control now. */}
          <div className="hra-row-wrap gap-3 justify-center items-center">
            {plannedModel && (
              <MetricRow
                color="var(--data-pace)"
                label={t("activity.plannedWorkout.legendPlanned", "Planned")}
                state={{ active: plannedShown, available: true, cardOn: plannedCardShown }}
                onToggle={field => (field === "active" ? setPlannedShown(!plannedShown) : setPlannedCardShown(!plannedCardShown))}
              />
            )}
            {plannedOverlay && (
              // Same shared swatch classes/`--legend-color` hook
              // SportTrendOverlapChart's own current-vs-compare legend
              // uses (docs/frontend.md) — scoped longer here
              // (.hra-activity-plan-legend, index.css) so they read clearly
              // next to the pill. Solid line swatch = the real activity's
              // line (speed/pace's own data-pace token, its own scale);
              // translucent fill swatch = the planned band's area-only fill
              // on the chart (no border line there any more either).
              // `text-meta` sits on the inner spans, not this row div —
              // index.css's `div.text-meta { margin-bottom: 4px }` (a
              // typography rule for text-meta used as a caption) would
              // otherwise nudge this row down off-center from the pill
              // beside it, which has no such margin. */}
              <div className="hra-activity-plan-legend hra-text-muted flex gap-3.5 items-center flex-wrap">
                <span className="hra-row-inline gap-1.5 text-meta">
                  <span className="hra-row-inline" style={{ "--legend-color": "var(--data-pace)" } as CSSProperties}>
                    <span className="hra-series-swatch--line" />
                  </span>
                  {t("activity.plannedWorkout.legendActual", "Actual")}
                </span>
                <span className="hra-row-inline gap-1.5 text-meta">
                  <span className="hra-row-inline" style={{ "--legend-color": "var(--data-pace)" } as CSSProperties}>
                    <span className="hra-series-swatch--fill" />
                  </span>
                  {t("activity.plannedWorkout.legendPlanned", "Planned")}
                </span>
              </div>
            )}
            {plannedDays.length >= 2 && (
              <div className="hra-row-inline gap-2 items-center">
                <span className="hra-text-secondary text-label">{t("activity.plannedWorkout.pickerLabel", "Compare to plan")}</span>
                <Select
                  value={String(selectedPlannedDayId)}
                  onValueChange={v => setSelectedPlannedDayId(Number(v))}
                  options={plannedDays.map(d => ({
                    value: String(d.id),
                    label: d.instance_name ?? t("activity.plannedWorkout.unnamedInstance", "Unnamed plan"),
                  }))}
                />
              </div>
            )}
          </div>
          <div className="hra-row-wrap gap-2 justify-end">
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
      {chartMounted ? (
        <>
          <div className="hra-runner-row relative mb-1" style={{ "--runner-row-height": `${RUNNER_ROW_HEIGHT}px` } as CSSProperties}>
            {runnerReady ? (
              <>
                <RunnerTerrain dynamics={rowDynamics} xs={terrainXs} height={RUNNER_ROW_HEIGHT} />
                <RunnerIcon ref={runnerIconRef} />
              </>
            ) : (
              // Stands in for the terrain/runner while plotWidth/chartData
              // aren't ready yet (dashboard design-system rework) — an
              // indeterminate sweep, not a real percentage (there's nothing
              // granular to report).
              <LoadingSpinner compact label={t("activity.chart.preparingRunner", "Preparing the runner…")} />
            )}
          </div>
          <div ref={plotRef} className="relative">
          <RunnerReadout ref={runnerReadoutRef} xMode={xMode} metrics={effectiveActive} speedMode={speedMode} pauseHr={pauseHrAt} />
          <MainOverlayChart
            chartData={chartData} displayTrack={displayTrack} xTicks={xTicks} xMode={xMode}
            speedDomain={speedDomain} speedMode={speedMode} activeMetrics={activeMetrics} effectiveActive={effectiveActive}
            rightMargin={mainChartRightMargin} plannedOverlay={plannedOverlay}
            onMouseMove={handleChartMouseMove} onMouseLeave={handleChartMouseLeave}
          />
          {/* Hover-highlight overlay — two plain CSS layers on top of the SVG,
              not part of it, so the chart's own data-driven colors are never
              touched. Position tracks the cursor via --hover-x, set
              imperatively in handleChartMouseMove/Leave above (see
              setHoverHighlight) — no React re-render per mouse event. */}
          <div ref={hoverDimRef} className="hra-chart-hover-dim" data-active="false" />
          <div ref={hoverGlowRef} className="hra-chart-hover-glow" data-active="false" />
          </div>
        </>
      ) : (
        // The deferred-mount placeholder (see chartMounted's own comment
        // above) — sized to the combined runner-row + chart height so
        // nothing visibly jumps once the real content mounts a frame later.
        // MAIN_CHART_HEIGHT matches MainOverlayChart's own
        // ResponsiveContainer height (220) — the one place that number
        // exists outside OverlayCharts.tsx, so it's named here rather than
        // repeated as a bare literal.
        <div className="hra-activity-chart-placeholder" style={{ "--activity-chart-placeholder-height": `${RUNNER_ROW_HEIGHT + 4 + MAIN_CHART_HEIGHT}px` } as CSSProperties}>
          <LoadingSpinner compact label={t("activity.chart.preparingRunner", "Preparing the runner…")} />
        </div>
      )}
      </ChartCard>

      {/* HRA-208: the planned-workout card — first under the main chart,
          ahead of every metric card, while the "Card" toggle above is on. */}
      {plannedModel && plannedCardShown && (
        <PlannedPaceTargetChart model={plannedModel} className="hra-activity-metric-card" />
      )}

      {effectiveActive.filter(key => showCard[key]).map(key => {
        const domain = cardDomains[key]!;
        // Pause flags render only on the main overlay chart above —
        // repeating them on every standalone card was noise. The
        // one exception is Heart rate, which gets its own
        // recovery-delta flag instead (a different signal: HR drop
        // across the pause, not the pause's duration).
        const cardData = key === "heart_rate" ? hrRecoveryChartData : chartData;
        return (
          <div key={key} className="hra-activity-metric-card">
            <Label className="mb-1">
              {key === "speed"
                ? (speedMode === "speed" ? t("activity.metric.speedLabel", "Speed") : t("activity.metric.paceLabel", "Pace"))
                : t(`activity.metric.${key}`, METRIC_DEFS[key].label)}
              {key === "heart_rate" && <span className="ml-2 font-normal normal-case tracking-normal">{t("activity.chart.hrRecoveryFlagsNote", "flags show HR recovery across each pause")}</span>}
            </Label>
            <MetricStandaloneCard
              metricKey={key} cardData={cardData} domain={domain} xTicks={xTicks} xMode={xMode} speedMode={speedMode}
              mainChartData={chartData}
            />
          </div>
        );
      })}
    </div>
  );
}
