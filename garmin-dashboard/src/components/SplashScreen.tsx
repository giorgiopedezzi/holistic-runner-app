import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MapPin, Gauge, Heart } from "lucide-react";
import { api } from "@/api/client";
import type { Activity, TrackPoint } from "@/types/api";
import { detectPauses, nearestHr } from "@/domain/pauses";
import { buildChartData, distanceTicks, axisDomainCentered, type ChartRow, type MetricKey } from "@/domain/activity-chart";
import { computeRunnerDynamics, NEUTRAL_DYNAMICS, RUNNER_ELEVATION_MAX_PX, type RunnerDynamics } from "@/domain/runner-dynamics";
import { hrRunnerColor, PAUSE_DWELL_MS, xToPixel, AXIS_WIDTH, MARGIN_LEFT, MARGIN_RIGHT, RIGHT_AXES_WIDTH } from "@/components/activity/shared";
import { RunnerTerrain } from "@/components/activity/RunnerTerrain";
import { RunnerIcon, type RunnerIconHandle } from "@/components/activity/RunnerIcon";
import { RunnerReadout, type RunnerReadoutHandle } from "@/components/activity/RunnerReadout";
import { MainOverlayChart } from "@/components/activity/OverlayCharts";
import { fmtKm, fmtSpeed } from "@/utils/fmt";
import { speedUnitLabel } from "@/utils/units";
import { LoadingSpinner, ChartCard, GraphKpiCard, splitUnit } from "@/components/ui";

// HRA-223: the reference training session the splash replays — 2026-08-24,
// 12.3km, ~82.8min. Hardcoded per the Story's scope (not user-configurable).
const SPLASH_ACTIVITY_ID = 201;
const SPLASH_SESSION_KEY = "hra-splash-shown";
// Same default pause threshold ActivityDetailBody starts with.
const PAUSE_THRESHOLD_SEC = 30;
// Same glyph/hop clearance ActivityChartSection's own runner row reserves
// (RUNNER_BAND_HEIGHT=36 there) plus the elevation-ride band either side.
const RUNNER_ROW_HEIGHT = 36 + 2 * RUNNER_ELEVATION_MAX_PX;
// Splash-only playback pace — deliberately its own constant, not
// shared.ts's PLAYBACK_DURATION_MS (ActivityChartSection's Play/Stop control
// keeps compressing the full activity into ~30s; the splash's autoplay is a
// separate, faster preview of the same track).
const SPLASH_PLAYBACK_DURATION_MS = 10000;
// Hold the final frame before switching to the home page, once the runner
// animation finishes on its own (not on Skip, which dismisses immediately).
const SPLASH_END_HOLD_MS = 5000;
// Hold on the runner's starting pose before playback begins, so it doesn't
// appear already mid-stride the instant the splash mounts.
const SPLASH_START_HOLD_MS = 1000;
// The one optional metric the splash shows alongside the mandatory Speed/
// Pace line — same default ActivityDetailBody starts a fresh activity view
// with (activeMetrics=["heart_rate"]).
const SPLASH_METRICS: MetricKey[] = ["speed", "heart_rate"];

function rowColor(row: ChartRow): string {
  const hr = row.heart_rate;
  return typeof hr === "number" ? hrRunnerColor(hr) : "var(--data-hr)";
}

// New splash gate, mounted once at the top of AppShell (HRA-223) — shows the
// app's intro copy plus the existing runner-glyph autoplay animation (reused
// from ActivityChartSection's Play/Stop control, not rebuilt) replaying a
// real training session, before the dashboard underneath. Standalone: no
// chart, no axes, no hover — just the terrain + glyph running once, driven
// by the same pixel math/constants as the chart's own autoplay loop (see
// components/activity/shared.ts).
export function SplashScreen() {
  const { t } = useTranslation();
  // sessionStorage, not the backend `settings` table every other persisted
  // preference in this app uses (.claude/rules/frontend.md): this flag is
  // ephemeral, tab-scoped "have I shown this once" state with no reason to
  // survive a closed tab or sync across devices — the Story's own AC (HRA-223)
  // requires exactly that per-tab-session behavior, which the backend table
  // doesn't give for free.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
    } catch {
      return false; // storage unavailable (e.g. private mode) — show it anyway
    }
  });
  const [track, setTrack] = useState<TrackPoint[] | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    if (dismissed) return;
    let ignore = false;
    api.garmin.track(SPLASH_ACTIVITY_ID)
      .then(trk => { if (!ignore) setTrack(trk); })
      .catch(() => { if (!ignore) setTrack([]); });
    api.garmin.activity(SPLASH_ACTIVITY_ID)
      .then(act => { if (!ignore) setActivity(act); })
      .catch(() => {}); // badges just stay hidden — the runner/chart don't depend on this
    return () => { ignore = true; };
  }, [dismissed]);

  function handleDismiss() {
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {
      // storage unavailable — dismissal still works for this render, just
      // won't be remembered across a reload.
    }
    setDismissed(true);
  }

  const chartData = useMemo(() => {
    if (!track) return [];
    const pauses = detectPauses(track, PAUSE_THRESHOLD_SEC);
    return buildChartData(track, pauses, "distance", SPLASH_METRICS, "speed");
  }, [track]);
  const rowDynamics = useMemo<RunnerDynamics[]>(
    () => (track ? computeRunnerDynamics(track, chartData) : []),
    [track, chartData],
  );
  // Speed/Pace's own axis domain — same centered-mean math ActivityDetailBody
  // feeds MainOverlayChart with (axisDomainCentered), off the raw track since
  // the splash has no outlier-removal toggle to apply first.
  const speedDomain = useMemo<[number, number]>(
    () => (track ? axisDomainCentered(track, "speed", "speed") : [0, 1]),
    [track],
  );
  const xTicks = useMemo(() => distanceTicks(chartData), [chartData]);
  // Heart rate's axis is always shown here (SPLASH_METRICS is fixed, not
  // toggleable) — same mainChartRightMargin math ActivityChartSection uses
  // when its own HR axis is on.
  const rightMargin = MARGIN_RIGHT;

  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setPlotWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const terrainXs = useMemo(() => {
    if (plotWidth === 0 || chartData.length === 0) return [];
    const domainMin = chartData[0].x, domainMax = chartData[chartData.length - 1].x;
    return chartData.map(row =>
      xToPixel(row.x, domainMin, domainMax, plotWidth, MARGIN_LEFT + AXIS_WIDTH, MARGIN_RIGHT + RIGHT_AXES_WIDTH));
  }, [plotWidth, chartData]);

  const runnerReady = plotWidth !== 0 && chartData.length > 0;
  const runnerIconRef = useRef<RunnerIconHandle>(null);
  // The "constantly updated data" readout ActivityChartSection pins below
  // its own chart — distance/pace/HR per row, plus HR-before→after-with-
  // delta on a pause row (the "HR recovery" the badges above don't show,
  // since Avg HR is a single summary number, not a per-pause one). Reused
  // as-is; only its data source (the autoplay loop's own showRow, below)
  // differs from ActivityChartSection's mouse+autoplay dual drive.
  const runnerReadoutRef = useRef<RunnerReadoutHandle>(null);
  function pauseHrAt(row: ChartRow): { before: number | null; after: number | null } {
    if (row.pauseAfterIndex == null || !track) return { before: null, after: null };
    return {
      before: nearestHr(track, row.pauseAfterIndex, -1),
      after: nearestHr(track, row.pauseAfterIndex + 1, 1),
    };
  }

  // Distance / Speed-Pace / Avg HR — the same three summary badges
  // ActivityChartSection pins beside its Play/Stop control, kept here as
  // plain informational badges (no click handler) since they're data, not a
  // CTA — the earlier "omit all the CTA" call only meant interactive
  // controls (toggles, Play/Stop, legend).
  const distanceKm = activity ? splitUnit(fmtKm(activity.distance_m)) : null;
  const speedPaceKpi = activity
    ? { value: fmtSpeed(activity.avg_speed_ms), unit: speedUnitLabel(), label: t("activity.metric.speedLabel", "Speed") }
    : null;

  // Same "light effect" ActivityChartSection's own autoplay drives (see that
  // file's setHoverHighlight/showRow) — two CSS-only overlay layers over the
  // chart's plot area, positioned by --hover-x and toggled via a data
  // attribute rather than React state, so a 60fps loop never re-renders the
  // chart. Reused verbatim (.hra-chart-hover-dim/-glow, index.css) rather
  // than rebuilt, same "no new visual system" constraint the Story's own
  // scope names.
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

  // Re-synced every render, same "always read current data/layout" pattern
  // ActivityChartSection's own playCtxRef uses — so a plotWidth change
  // mid-play (e.g. a window resize) doesn't leave the loop reading stale
  // geometry, and doesn't need to restart the RAF loop to pick it up.
  const playCtxRef = useRef({ chartData, rowDynamics, plotWidth });
  useEffect(() => { playCtxRef.current = { chartData, rowDynamics, plotWidth }; });

  const rafRef = useRef<number | null>(null);
  const clockRef = useRef(0);
  const rowIdxRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const dwellUntilRef = useRef<number | null>(null);
  const lastDwellIdxRef = useRef<number | null>(null);
  const startedRef = useRef(false);

  // Starts once, the first time the runner has real geometry to animate
  // against — mirrors ActivityChartSection's step()/advanceRow() (see that
  // file's "Autoplay" section) minus the parts that only make sense with a
  // Play/Stop control or a mouse (no hover, no pause/resume, no idle pose —
  // the splash always plays through once and dismisses itself at the end).
  useEffect(() => {
    if (!runnerReady || startedRef.current) return;
    startedRef.current = true;

    function pixelX(x: number): number {
      const { chartData: data, plotWidth: w } = playCtxRef.current;
      const domainMin = data[0]?.x ?? 0, domainMax = data[data.length - 1]?.x ?? 0;
      return xToPixel(x, domainMin, domainMax, w, MARGIN_LEFT + AXIS_WIDTH, MARGIN_RIGHT + RIGHT_AXES_WIDTH);
    }
    function showRow(row: ChartRow, idx: number, dwelling: boolean) {
      const cx = pixelX(row.x);
      const dynamics = playCtxRef.current.rowDynamics[idx] ?? NEUTRAL_DYNAMICS;
      runnerIconRef.current?.show(cx, rowColor(row), row.pauseDurationSec ?? null, dwelling, dynamics);
      runnerReadoutRef.current?.show(row);
      setHoverHighlight(cx);
    }
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
    function step(ts: number) {
      if (dwellUntilRef.current != null) {
        if (ts < dwellUntilRef.current) { rafRef.current = requestAnimationFrame(step); return; }
        dwellUntilRef.current = null;
        lastTsRef.current = ts;
      }
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;

      const { chartData: data, rowDynamics: dyn } = playCtxRef.current;
      const totalSec = dyn[data.length - 1]?.movingSec ?? 0;
      const rate = totalSec / SPLASH_PLAYBACK_DURATION_MS;
      clockRef.current += dt * rate;

      if (clockRef.current >= totalSec) {
        rafRef.current = null;
        setTimeout(handleDismiss, SPLASH_END_HOLD_MS);
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

    const { chartData: data, rowDynamics: dyn } = playCtxRef.current;
    // No moving time to play through (e.g. a corrupt/empty track) — nothing
    // to animate, so dismiss rather than sit frozen on the first frame with
    // only Skip able to close it.
    if ((dyn[data.length - 1]?.movingSec ?? 0) <= 0) { handleDismiss(); return; }
    showRow(data[0], 0, false);
    const startTimer = setTimeout(() => {
      rafRef.current = requestAnimationFrame(step);
    }, SPLASH_START_HOLD_MS);
    return () => clearTimeout(startTimer);
  }, [runnerReady]);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  if (dismissed) return null;

  return (
    <div className="hra-splash-layer hra-splash-backdrop fixed inset-0 flex flex-col items-center justify-center gap-10 p-6">
      {/* Brand lockup — upper-left, not glued to the corner (direct
          feedback: the splash had no "Dreams run free" identity on it). Static,
          same not-translated role App.tsx's sidebar brand has — "Dreams run free"
          is the brand name, not copy, so it's a hardcoded literal rather
          than routed through t() even though every other string on this
          screen is. "free" picks up the heart-rate red (see index.css) to
          connect the mark to the runner animation beside it. */}
      <div className="hra-splash-brand">
        <p className="hra-splash-brand-title">Dreams run <span className="hra-splash-brand-accent">free</span></p>
      </div>
      <div className="hra-splash-copy text-display hra-text-primary text-center max-w-2xl">
        <p>{t("splash.headline", "Your run, brought into focus.")}</p>
        <p className="hra-splash-copy-subtagline">{t("splash.subtagline", "Only the data that matters.")}</p>
        <p>{t("splash.copyPace", "Your pace.")}</p>
        <p className="hra-splash-copy-heart">{t("splash.copy4", "Your heart.")}</p>
        <p className="hra-splash-copy-you">{t("splash.copy5", "You.")}</p>
      </div>
      <div className="w-full max-w-2xl">
        <ChartCard
          subHeader={distanceKm && speedPaceKpi && (
            <div className="hra-row-wrap gap-2 justify-end">
              <GraphKpiCard icon={<MapPin size={16} />} iconColor="var(--accent)"
                value={distanceKm.main} unit={distanceKm.unit} label={t("activity.stat.distance", "Distance")} />
              <GraphKpiCard icon={<Gauge size={16} />} iconColor="var(--accent)"
                value={speedPaceKpi.value} unit={speedPaceKpi.unit} label={speedPaceKpi.label} />
              {activity?.avg_hr != null && (
                <GraphKpiCard icon={<Heart size={16} color={hrRunnerColor(activity.avg_hr)} />} iconColor={hrRunnerColor(activity.avg_hr)}
                  valueColor={hrRunnerColor(activity.avg_hr)} value={`${activity.avg_hr}`} unit="bpm" label={t("activity.stat.avgHr", "Avg HR")} />
              )}
            </div>
          )}
        >
          <div className="hra-runner-row relative mb-1" style={{ "--runner-row-height": `${RUNNER_ROW_HEIGHT}px` } as CSSProperties}>
            {runnerReady ? (
              <>
                <RunnerTerrain dynamics={rowDynamics} xs={terrainXs} height={RUNNER_ROW_HEIGHT} />
                <RunnerIcon ref={runnerIconRef} />
              </>
            ) : (
              <LoadingSpinner compact label={t("activity.chart.preparingRunner", "Preparing the runner…")} />
            )}
          </div>
          {/* Non-interactive: no onMouseMove/onMouseLeave handler does
              anything (no-ops below) — the splash has no hover, no
              Play/Stop, no metric/axis toggles, only the Skip button. The
              hover-dim/hover-glow overlay still lights up, but it's driven
              by the autoplay's own cx (setHoverHighlight in showRow above),
              the same "light effect" ActivityChartSection's real autoplay
              drives — not by mouse events here. */}
          <div ref={plotRef} className="relative pointer-events-none">
            <RunnerReadout ref={runnerReadoutRef} xMode="distance" metrics={SPLASH_METRICS} speedMode="speed" pauseHr={pauseHrAt} />
            {runnerReady && (
              <MainOverlayChart
                chartData={chartData} displayTrack={track ?? []} xTicks={xTicks} xMode="distance"
                speedDomain={speedDomain} speedMode="speed" activeMetrics={["heart_rate"]} effectiveActive={SPLASH_METRICS}
                rightMargin={rightMargin} plannedOverlay={null}
                onMouseMove={() => {}} onMouseLeave={() => {}}
              />
            )}
            <div ref={hoverDimRef} className="hra-chart-hover-dim" data-active="false" />
            <div ref={hoverGlowRef} className="hra-chart-hover-glow" data-active="false" />
          </div>
        </ChartCard>
      </div>
      <button type="button" className="hra-btn" data-variant="outline" onClick={handleDismiss}>
        {t("splash.skip", "Skip")}
      </button>
    </div>
  );
}
