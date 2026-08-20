import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import i18next from "@/i18n";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";
import { api } from "@/api/client";
import {
  Card, ChartCard, chartGrid, chartTick,
  Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, Badge, RangeEmpty,
  splitUnit,
} from "@/components/ui";
import { DateRangeBar } from "@/components/DateRangeBar";
import { ActivityRow } from "@/components/activity/ActivityRow";
import { ActivityModal, ActivityDetailBody } from "@/components/ActivityModal";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { fmtPace, fmtKm, fmtElevation, fmtMinSecRaw, fmtDate } from "@/utils/fmt";
import { getUnitSystem, kmToMi, paceKmToMi, distanceUnitLabel, paceUnitLabel } from "@/utils/units";
import {
  type GroupMode, defaultGroupMode, isoWeekStart, buildTrendPoints, meanCenteredDomain, swimPacePer100m,
  groupActivitiesBySport, type AlignMode, type OverlapPoint, buildOverlapPoints,
} from "@/domain/trends";

interface Props {
  // The full live state (not just from/to strings) — this tab renders its
  // own DateRangeBar now (moved out of App.tsx) so it can wrap it and the
  // Summary card together in one sticky header, and the named-range rows
  // need the real setters to "set the interval" when a saved range is
  // picked. useCompareRange already keeps compareRange in sync with range
  // on its own (defaultCompareRange, see that hook) — no fallback needed
  // here any more.
  range: DateRangeState;
  compareRange: CompareRangeState;
}

// ── Distance/pace/HR trend, one chart per sport ─────────────────────────────
// Bars are total distance per group (one activity per bar in "single" mode,
// summed across the group in "week"/"month" mode); the pace and HR lines
// connect one point per bar, at that bar's x position — Recharts' default
// categorical-axis behavior already centers Bar and Line data at the same x
// tick, so no manual positioning is needed for "starts from the horizontal
// center of the bar."
const GROUP_MODES: GroupMode[] = ["single", "week", "month"];
const GROUP_LABEL: Record<GroupMode, string> = { single: "Single", week: "Week", month: "Month" };
// Whether current and compare render as one overlapped chart (default) or
// two separate ones, side by side — a per-tab toggle (TrendsBySport), only
// shown while comparison is enabled.
type TrendViewMode = "overlap" | "distinct";

// The distinct<->overlap switch is a two-step choreography, not a plain
// mount fade — SportTrendPair steps through these phases on a timer:
// distinct -> overlap: "d2o-move" (the compare card slides up until it
//   overlaps the current card) -> "d2o-fade" (the merged pair crossfades
//   into the single overlap chart) -> settle at "overlap".
// overlap -> distinct: "o2d-fade" (the overlap chart crossfades into the
//   distinct pair, compare card starting already merged over current) ->
//   "o2d-slide" (the compare card slides back down into its own slot) ->
//   settle at "distinct".
type TrendPhase = TrendViewMode | "d2o-move" | "d2o-fade" | "o2d-fade" | "o2d-slide";
const TREND_PHASE_MS = 1000;

const axisStyle = chartTick;
const gridStyle = chartGrid;

// Pace's color is the app's fixed semantic data color for pace (HRA-94/97:
// --data-pace), matching ActivityModal.tsx's METRIC_DEFS.speed.color exactly
// — the activity detail view is this app's color "reference" for speed/pace,
// so this chart reuses the same token instead of a generic accent, for one
// consistent color across the whole app. HR uses --data-hr (was --accent-red;
// same hex today, but the semantic token is the one that's never allowed to
// vary with the user's accent, per HRA-94/97). Bars are a neutral gray, not a
// per-sport color — SPORT_COLOR can collide with the pace/HR line colors
// (cycling's SPORT_COLOR was literally identical to this chart's old pace
// blue, and running's green measured ~1.3:1 mutual contrast against it,
// effectively invisible where a line crossed a bar) — a neutral fill has no
// such collision regardless of sport or line color. Sport identity still
// shows via the Badge above the chart, which keeps SPORT_COLOR.
const PACE_LINE_COLOR = "var(--data-pace)";
const BAR_COLOR = "var(--text-secondary)";
// Correction pass: distance bars are a MUTED --data-pace volume wash (28%→8%
// opacity gradient, tightened from an earlier 55%→12% pass) with a tighter
// top radius than the app-wide chartBarRadius default. Deliberately faint —
// they must read as background volume, never as the pace series itself,
// which is what the full-strength Avg-pace LINE is for (see frontend.md).
// BAR_COLOR above stays the axis-tick/tooltip-adjacent neutral, only the bar
// FILL itself picks up the gradient (defined inline as an SVG <linearGradient>
// per chart — no CSS-class equivalent for SVG gradient stops).
const BAR_RADIUS: [number, number, number, number] = [6, 6, 0, 0];

// Max distinct x-axis tick labels before sampling kicks in — "too many
// activities/groups" (e.g. a long Single-mode range, or Week mode over a
// long span) otherwise renders one illegible label per bar. Recharts'
// XAxis `interval` prop is a skip-count (0 = show every tick), so a numeric
// interval is derived from the actual point count each render.
const MAX_X_LABELS = 8;
function sampleInterval(count: number): number {
  return count <= MAX_X_LABELS ? 0 : Math.ceil(count / MAX_X_LABELS) - 1;
}

// One side's plain trend chart (Distance/Avg pace/Avg HR, all three ALWAYS
// shown — no toggle pills, no avg/min/max reference lines; both removed per
// explicit feedback) — used for "Distinct" view mode's two separate charts.
// `points` are pre-scaled (imperial/swim, done once by the caller,
// SportTrendPair, so scaling logic isn't duplicated across this and
// SportTrendOverlapChart) and `kmDomain`/`paceDomain`/`hrDomain` are also
// caller-supplied — computed once from BOTH sides combined, so current and
// compare's separate charts still share one Y-axis range per measure (the
// "vertical axis must cover the same range for both" rule).
function SportTrendChart({ sport, points, title, kmDomain, paceDomain, hrDomain }: {
  sport: string; title: string;
  points: { label: string; totalKm: number; avgPace: number | null; avgHr: number | null }[];
  kmDomain: [number, number]; paceDomain: [number, number]; hrDomain: [number, number];
}) {
  const { t } = useTranslation();
  const isSwimming = sport === "swimming";
  const imperial = getUnitSystem() === "imperial";
  const paceUnit = isSwimming ? "/100m" : (imperial ? "/mi" : "/km");
  const distanceUnit = distanceUnitLabel();
  const hrColor = "var(--data-hr)"; // fixed semantic data color (HRA-94/97) — was --accent-red, same hex today
  const gradId = useId();
  const interval = sampleInterval(points.length);

  return (
    <div style={{ marginBottom: 12 }}>
      <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points}>
          <defs>
            <linearGradient id={`${gradId}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--data-pace)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--data-pace)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval={interval} />
          {/* Three separate tick-label columns — km and pace stacked on the
              left (Recharts stacks multiple visible same-side axes
              automatically), HR alone on the right — each tinted to match
              its own line/bar color so the column and its series are
              visually tied together. Pace is reversed — lower (faster)
              reads toward the top, this chart always shows pace (never
              speed), so unlike ActivityModal this doesn't need to be
              conditional. Domains are caller-supplied (see doc comment
              above), not self-computed — that's what makes current and
              compare's separate charts share one range. */}
          <YAxis yAxisId="km" domain={kmDomain} tick={{ fill: BAR_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={32}
            tickFormatter={(v: number) => v.toFixed(0)} />
          <YAxis yAxisId="pace" orientation="left" domain={paceDomain} reversed
            tick={{ fill: PACE_LINE_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={34}
            tickFormatter={(v: number) => fmtMinSecRaw(v)} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain}
            tick={{ fill: hrColor, fontSize: 9 }} tickLine={false} axisLine={false} width={30}
            tickFormatter={(v: number) => Math.round(v).toString()} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const get = (name: string) => payload.find(p => p.name === name)?.value;
              const kmVal = get("Distance");
              const paceVal = get("Avg pace");
              const hrVal = get("Avg HR");
              // Two rows — the date/period label on its own line, the three
              // metrics ("6.5 km · pace 5:12 · HR 158") on the next, each
              // colored to match its series — instead of one long inline
              // line, or Recharts' default three separately-swatched rows.
              return (
                <div className="hra-chart-tooltip hra-col" style={{ gap: 2 }}>
                  <span className="hra-chart-tooltip-label">{label}</span>
                  <div className="hra-row" style={{ gap: 6 }}>
                    {typeof kmVal === "number" && (
                      <span className="hra-chart-tooltip-km">{kmVal.toFixed(1)} {distanceUnit}</span>
                    )}
                    {typeof paceVal === "number" && (
                      <>{typeof kmVal === "number" && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-pace">{t("overview.chartTooltip.pace", "pace")} {fmtMinSecRaw(paceVal)}{paceUnit}</span></>
                    )}
                    {typeof hrVal === "number" && (
                      <>{(typeof kmVal === "number" || typeof paceVal === "number") && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-hr">{t("overview.chartTooltip.hr", "HR")} {Math.round(hrVal)}</span></>
                    )}
                  </div>
                </div>
              );
            }}
          />
          <Bar yAxisId="km" dataKey="totalKm" name="Distance" fill={`url(#${gradId}-bar)`} radius={BAR_RADIUS}
            activeBar={{ fill: "var(--data-pace)", fillOpacity: 0.4 }} isAnimationActive={false} />
          <Line yAxisId="pace" dataKey="avgPace" name="Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2.5}
            className="hra-trend-line-pace"
            dot={{ r: 2.5, fill: PACE_LINE_COLOR, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: PACE_LINE_COLOR, stroke: "var(--bg-card)", strokeWidth: 2 }}
            connectNulls isAnimationActive={false} />
          <Line yAxisId="hr" dataKey="avgHr" name="Avg HR" stroke={hrColor} strokeWidth={2.5}
            className="hra-trend-line-hr"
            dot={{ r: 2.5, fill: hrColor, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: hrColor, stroke: "var(--bg-card)", strokeWidth: 2 }}
            connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// Two-row x-axis tick ("Overlapping" view) — current period's date label on
// top, compare period's underneath, at the shared slot position. A factory
// (not a plain component) because Recharts' `tick` prop only receives
// {x, y, index} from the axis, not the actual data point; closing over
// `points` is how the tick renderer gets at currentLabel/compareLabel.
interface TwoRowTickProps { x?: string | number; y?: string | number; index?: number }
function makeTwoRowTick(points: OverlapPoint[]) {
  return function TwoRowTick({ x = 0, y = 0, index = 0 }: TwoRowTickProps) {
    const p = points[index];
    if (!p) return null;
    return (
      <g transform={`translate(${Number(x)},${Number(y)})`}>
        <text x={0} y={10} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">{p.currentLabel ?? ""}</text>
        <text x={0} y={22} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{p.compareLabel ?? ""}</text>
      </g>
    );
  };
}

// "Overlapping" view's merged current-vs-compare chart — ONE chart instead
// of two: no Distance/Avg pace/Avg HR toggle pills (all three always
// shown), no avg/min/max reference lines, current and compare sharing one
// set of axes and one x-axis (`points`, pre-built by the caller via
// buildOverlapPoints, and pre-scaled the same way SportTrendChart's are).
// Current is solid/filled, compare is dashed (lines) or larger+more
// transparent (bars, so it visibly peeks out from behind) — a small
// non-interactive legend is the only thing distinguishing them, since color
// alone doesn't (same per-metric color for both sides, "color follows the
// metric," matching this app's convention elsewhere).
//
// Bars TRULY overlap (same x center), not Recharts' default side-by-side
// grouping, via the standard two-XAxis trick: `xMain` (visible, the actual
// tick labels) and `xOverlay` (hidden) both key off the same `dataKey="slot"`
// / `data` array, so their categories/positions compute identically: only
// elements sharing ONE xAxisId get auto-spaced relative to each other, so
// putting the compare bar on its own axis stops it being pushed aside.
function SportTrendOverlapChart({ sport, title, points, compareEnabled, kmDomain, paceDomain, hrDomain }: {
  sport: string; title: string; points: OverlapPoint[]; compareEnabled: boolean;
  kmDomain: [number, number]; paceDomain: [number, number]; hrDomain: [number, number];
}) {
  const { t } = useTranslation();
  const isSwimming = sport === "swimming";
  const imperial = getUnitSystem() === "imperial";
  const paceUnit = isSwimming ? "/100m" : (imperial ? "/mi" : "/km");
  const distanceUnit = distanceUnitLabel();
  const hrColor = "var(--data-hr)";
  const twoRowTick = useMemo(() => makeTwoRowTick(points), [points]);
  const interval = sampleInterval(points.length);
  const gradId = useId();

  return (
    <div className="hra-overlap-card-enter" style={{ marginBottom: 12 }}>
      <ChartCard title={title} legend={compareEnabled && (
        <div className="hra-text-muted" style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 11 }}>
          <span className="hra-row-inline">
            <span className="hra-legend-line-swatch" style={{ display: "inline-block", width: 14 }} /> {t("overview.legend.current", "Current")}
          </span>
          <span className="hra-row-inline">
            <span className="hra-legend-bar-swatch" style={{ display: "inline-block", width: 14, height: 8, opacity: 0.25, borderRadius: 2 }} /> {t("overview.legend.compare", "Compare")}
          </span>
        </div>
      )}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={points} margin={{ bottom: 8 }}>
          <defs>
            <linearGradient id={`${gradId}-cur`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--data-pace)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--data-pace)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis xAxisId="xMain" dataKey="slot" tick={twoRowTick} tickLine={false} axisLine={false} height={40} interval={interval} />
          {compareEnabled && <XAxis xAxisId="xOverlay" dataKey="slot" hide />}
          <YAxis yAxisId="km" domain={kmDomain} tick={{ fill: BAR_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={32}
            tickFormatter={(v: number) => v.toFixed(0)} />
          <YAxis yAxisId="pace" orientation="left" domain={paceDomain} reversed
            tick={{ fill: PACE_LINE_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={34}
            tickFormatter={(v: number) => fmtMinSecRaw(v)} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain}
            tick={{ fill: hrColor, fontSize: 9 }} tickLine={false} axisLine={false} width={30}
            tickFormatter={(v: number) => Math.round(v).toString()} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as OverlapPoint;
              // Each side (current/compare) gets its own two-row block —
              // label on top, the km/pace/HR metrics on the row below —
              // same convention as SportTrendChart's tooltip, rather than
              // one long inline line per side.
              const metricsRow = (km: number | null, pace: number | null, hr: number | null) => (
                <div className="hra-row" style={{ gap: 6 }}>
                  {km != null && <span className="hra-chart-tooltip-km">{km.toFixed(1)} {distanceUnit}</span>}
                  {pace != null && <>{km != null && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-pace">{t("overview.chartTooltip.pace", "pace")} {fmtMinSecRaw(pace)}{paceUnit}</span></>}
                  {hr != null && <>{(km != null || pace != null) && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-hr">{t("overview.chartTooltip.hr", "HR")} {Math.round(hr)}</span></>}
                </div>
              );
              return (
                <div className="hra-chart-tooltip hra-col" style={{ gap: 6 }}>
                  {p.currentLabel != null && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span className="hra-chart-tooltip-label">{p.currentLabel}</span>
                      {metricsRow(p.currentKm, p.currentPace, p.currentHr)}
                    </div>
                  )}
                  {compareEnabled && p.compareLabel != null && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, opacity: 0.75 }}>
                      <span className="hra-chart-tooltip-label">{p.compareLabel}</span>
                      {metricsRow(p.compareKm, p.comparePace, p.compareHr)}
                    </div>
                  )}
                </div>
              );
            }}
          />
          {/* Compare bar first (paint order = below), larger + more
              transparent, on its own hidden axis so it isn't pushed aside
              by the current bar — "always see it," per spec, even fully
              behind current's opaque, narrower bar. */}
          {compareEnabled && (
            <Bar xAxisId="xOverlay" yAxisId="km" dataKey="compareKm" name="Compare Distance"
              fill="var(--data-pace)" fillOpacity={0.18} radius={BAR_RADIUS} barSize={24} isAnimationActive={false} />
          )}
          <Bar xAxisId="xMain" yAxisId="km" dataKey="currentKm" name="Distance" fill={`url(#${gradId}-cur)`} radius={BAR_RADIUS}
            barSize={14} activeBar={{ fill: "var(--data-pace)", fillOpacity: 0.4 }} isAnimationActive={false} />
          <Line xAxisId="xMain" yAxisId="pace" dataKey="currentPace" name="Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2.5}
            className="hra-trend-line-pace" dot={{ r: 2.5, fill: PACE_LINE_COLOR, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: PACE_LINE_COLOR, stroke: "var(--bg-card)", strokeWidth: 2 }}
            connectNulls isAnimationActive={false} />
          {compareEnabled && (
            <Line xAxisId="xMain" yAxisId="pace" dataKey="comparePace" name="Compare Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2}
              strokeOpacity={0.55} strokeDasharray="5 4" dot={{ r: 2, fill: PACE_LINE_COLOR, strokeWidth: 0, fillOpacity: 0.55 }}
              connectNulls isAnimationActive={false} />
          )}
          <Line xAxisId="xMain" yAxisId="hr" dataKey="currentHr" name="Avg HR" stroke={hrColor} strokeWidth={2.5}
            className="hra-trend-line-hr" dot={{ r: 2.5, fill: hrColor, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: hrColor, stroke: "var(--bg-card)", strokeWidth: 2 }}
            connectNulls isAnimationActive={false} />
          {compareEnabled && (
            <Line xAxisId="xMain" yAxisId="hr" dataKey="compareHr" name="Compare Avg HR" stroke={hrColor} strokeWidth={2}
              strokeOpacity={0.55} strokeDasharray="5 4" dot={{ r: 2, fill: hrColor, strokeWidth: 0, fillOpacity: 0.55 }}
              connectNulls isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// Pairs a sport's current-period data with its comparison-period data —
// builds the shared alignment (buildOverlapPoints) AND cross-side Y-axis
// domains (so "distinct" mode's two separate charts and "overlap" mode's
// one merged chart all show the SAME vertical range per measure, current
// vs compare) up front, then renders whichever `viewMode` picked.
function SportTrendPair({ sport, activities, compareActivities, mode, minGroupSize, compareEnabled, from, compareFrom, viewMode }: {
  sport: string; activities: Activity[]; compareActivities: Activity[]; mode: GroupMode; minGroupSize: number;
  compareEnabled: boolean; from: string; compareFrom: string; viewMode: TrendViewMode;
}) {
  const { t } = useTranslation();
  const label = sport.charAt(0).toUpperCase() + sport.slice(1);
  const noun = mode === "single" ? "activities" : mode === "week" ? "weeks" : "months";
  const nounLabel = t(`overview.noun.${mode}`, noun);

  // Same "too few activities for single mode" rule as before — Week/Month
  // never trip it (their own too-sparse case is gated at the shared
  // Single/Week/Month toggle level in TrendsBySport, disabling the mode
  // entirely rather than per sport).
  const tooFew = (acts: Activity[]) => mode === "single" && acts.length < minGroupSize;

  // Only meaningful (and only shown) in Single mode, when there's an actual
  // mismatch to resolve — per spec, the switch exists "when the number of
  // activities does not match." Week/Month always use "index": each bucket
  // is already a period-relative slot ("week 2 of the period"), so position
  // IS "distance in time" there — no separate alignment choice needed.
  const [alignMode, setAlignMode] = useState<AlignMode>("index");

  // Steps `phase` through the choreography (see TrendPhase above) whenever
  // the OWNER's `viewMode` selection changes — `phase` (not `viewMode`)
  // drives rendering below, so the two intermediate steps get their own
  // render pass each. `!compareEnabled` skips straight to the target phase
  // (nothing to merge/split when there's no compare card at all).
  const [phase, setPhase] = useState<TrendPhase>(viewMode);
  const prevViewMode = useRef(viewMode);
  useEffect(() => {
    if (!compareEnabled) { prevViewMode.current = viewMode; setPhase(viewMode); return; }
    if (viewMode === prevViewMode.current) return;
    const from = prevViewMode.current;
    prevViewMode.current = viewMode;
    const mid: TrendPhase = from === "distinct" ? "d2o-move" : "o2d-fade";
    const late: TrendPhase = from === "distinct" ? "d2o-fade" : "o2d-slide";
    setPhase(mid);
    const t1 = setTimeout(() => setPhase(late), TREND_PHASE_MS);
    const t2 = setTimeout(() => setPhase(viewMode), TREND_PHASE_MS * 2);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [viewMode, compareEnabled]);

  const curPoints = useMemo(() => buildTrendPoints(activities, mode), [activities, mode]);
  const cmpPoints = useMemo(() => compareEnabled ? buildTrendPoints(compareActivities, mode) : [], [compareActivities, mode, compareEnabled]);
  const countsDiffer = mode === "single" && compareEnabled && curPoints.length !== cmpPoints.length;

  const overlapPoints = useMemo(
    () => buildOverlapPoints(curPoints, cmpPoints, from, compareFrom, mode === "single" ? alignMode : "index"),
    [curPoints, cmpPoints, from, compareFrom, mode, alignMode],
  );

  const isSwimming = sport === "swimming";
  const imperial = getUnitSystem() === "imperial";
  const scalePace = (m: number) => (isSwimming ? swimPacePer100m(m) : imperial ? paceKmToMi(m) : m);
  const scaleKm = (km: number) => (imperial ? kmToMi(km) : km);

  // Scaled ONCE here (not inside each chart) — both SportTrendChart and
  // SportTrendOverlapChart just render whatever they're given, so there's
  // one place imperial/swim conversion happens, and domains computed from
  // these same scaled values are guaranteed consistent with what's plotted.
  const scaledCur = useMemo(() => curPoints.map(p => ({
    ...p, totalKm: scaleKm(p.totalKm), avgPace: p.avgPace != null ? scalePace(p.avgPace) : null,
  })), [curPoints, imperial, isSwimming]);
  const scaledCmp = useMemo(() => cmpPoints.map(p => ({
    ...p, totalKm: scaleKm(p.totalKm), avgPace: p.avgPace != null ? scalePace(p.avgPace) : null,
  })), [cmpPoints, imperial, isSwimming]);
  const scaledOverlap = useMemo(() => overlapPoints.map(p => ({
    ...p,
    currentKm: p.currentKm != null ? scaleKm(p.currentKm) : null,
    compareKm: p.compareKm != null ? scaleKm(p.compareKm) : null,
    currentPace: p.currentPace != null ? scalePace(p.currentPace) : null,
    comparePace: p.comparePace != null ? scalePace(p.comparePace) : null,
  })), [overlapPoints, imperial, isSwimming]);

  // Shared cross-side domains — min of the mins, max of the maxes, across
  // BOTH current and compare, for all three measures. km's floor is fixed
  // at 0 (bars start there); pace/HR use the same mean-centered pattern the
  // rest of this tab already uses, just fed the combined array instead of
  // one side's own values.
  const allKm = scaledOverlap.flatMap(p => [p.currentKm, p.compareKm]).filter((v): v is number => v != null);
  const allPace = scaledOverlap.flatMap(p => [p.currentPace, p.comparePace]).filter((v): v is number => v != null);
  const allHr = scaledOverlap.flatMap(p => [p.currentHr, p.compareHr]).filter((v): v is number => v != null);
  const kmDomain: [number, number] = [0, allKm.length ? Math.max(...allKm) : 1];
  const paceDomainBase = meanCenteredDomain(allPace);
  const paceDomain: [number, number] = [Math.max(0, paceDomainBase[0]), paceDomainBase[1]];
  const hrDomain = meanCenteredDomain(allHr);

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="hra-control-row" style={{ gap: 10, marginBottom: 8 }}>
        <Badge label={sport} color={SPORT_COLOR[sport] ?? "#888"} />
        <span className="hra-text-muted" style={{ fontSize: 11 }}>
          {compareEnabled
            ? t("overview.sportCounts.withCompare", `${curPoints.length} current ${nounLabel} · ${cmpPoints.length} compare ${nounLabel}`, { count: curPoints.length, noun: nounLabel, compareCount: cmpPoints.length })
            : t("overview.sportCounts.base", `${curPoints.length} current ${nounLabel}`, { count: curPoints.length, noun: nounLabel })}
        </span>
        {countsDiffer && (
          <div className="hra-border-strong" style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden" }}
            title={t("overview.alignTooltip", "The two periods have a different number of activities — pick how to line them up")}>
            {([["index", "Match order"], ["time", "Match by time"]] as const).map(([m, l]) => (
              <button key={m} onClick={() => setAlignMode(m)}
                className="hra-dyn-bg hra-dyn-color"
                style={{
                  fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                  "--dyn-bg": alignMode === m ? "var(--bg-card)" : "transparent",
                  "--dyn-color": alignMode === m ? "var(--text-primary)" : "var(--text-muted)",
                } as CSSProperties}>
                {t(`overview.align.${m}`, l)}
              </button>
            ))}
          </div>
        )}
      </div>

      {tooFew(activities) ? (
        <Empty message={t("overview.tooFewCurrent", `Too few ${sport} activities to determine a trend (${activities.length} of ${minGroupSize} needed).`, { sport, count: activities.length, min: minGroupSize })} />
      ) : (() => {
        const currentChart = (
          <SportTrendChart sport={sport} title={`${label} - current`} points={scaledCur}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain} />
        );
        const compareCard = !compareEnabled ? null : tooFew(compareActivities) ? (
          <Empty message={t("overview.tooFewCompare", `Too few ${sport} activities in the compare range to determine a trend (${compareActivities.length} of ${minGroupSize} needed).`, { sport, count: compareActivities.length, min: minGroupSize })} />
        ) : (
          <SportTrendChart sport={sport} title={`${label} - comparison`} points={scaledCmp}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain} />
        );
        const overlapChart = (
          <SportTrendOverlapChart sport={sport} title={label} points={scaledOverlap} compareEnabled={compareEnabled}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain} />
        );
        // "Merged" = compareCard rendered as an absolutely-positioned overlay
        // (`.hra-merged`/`.hra-unmerge-down`, both `position:absolute;inset:0`)
        // spanning its `position: relative` sibling wrapper 1:1 — since
        // currentChart alone defines that wrapper's height, this stacks
        // compareCard exactly on top of currentChart with no dead space,
        // standing in for a real overlap without measuring pixels. Takes the
        // overlay class as a param — o2d-slide reuses this same shape, just
        // with `.hra-unmerge-down` (which starts from this identical
        // footprint) instead of the static `.hra-merged`.
        const mergedPair = (overlayClass = "hra-merged") => (
          <div style={{ position: "relative" }}>
            {currentChart}
            {compareCard && <div className={overlayClass}>{compareCard}</div>}
          </div>
        );

        switch (phase) {
          case "overlap":
            return overlapChart;
          case "distinct":
            return (
              <>
                {currentChart}
                {compareCard && <div style={{ marginTop: 12 }}>{compareCard}</div>}
              </>
            );
          case "d2o-move":
            // Compare card slides up (still in normal flow, so it briefly
            // leaves dead space below it) until it visually overlaps
            // current — the merged look `d2o-fade` picks up from.
            return (
              <>
                {currentChart}
                {compareCard && <div className="hra-merge-up" style={{ marginTop: 12 }}>{compareCard}</div>}
              </>
            );
          case "d2o-fade":
            return (
              <div className="hra-crossfade">
                <div className="hra-crossfade-out">{mergedPair()}</div>
                <div className="hra-crossfade-in">{overlapChart}</div>
              </div>
            );
          case "o2d-fade":
            return (
              <div className="hra-crossfade">
                <div className="hra-crossfade-out">{overlapChart}</div>
                <div className="hra-crossfade-in">{mergedPair()}</div>
              </div>
            );
          case "o2d-slide":
            // Compare card starts merged (matching o2d-fade's end state) and
            // slides down into its own slot — settling at "distinct" swaps
            // it back to normal in-flow positioning at the matching spot.
            return mergedPair("hra-unmerge-down");
        }
      })()}
    </div>
  );
}

// A grouping is only offered if it actually produces something worth
// grouping — fewer groups than the configured threshold (Settings tab,
// default 5) isn't a meaningful trend, it's just a couple of bars. The same
// threshold also gates whether a sport's chart is shown at all in "single"
// mode (see SportTrendPair's tooFew above) — one number, two uses.
const DEFAULT_MIN_TREND_GROUP_SIZE = 5;

// Unlike Props (from/to only), the compare window is required here — always
// resolved by the caller (OverviewTab) before rendering, whether that's the
// live App.tsx-driven pair or the same-shape default computed locally.
interface TrendsProps { from: string; to: string; compareFrom: string; compareTo: string; compareEnabled: boolean; }

function TrendsBySport({ from, to, compareFrom, compareTo, compareEnabled }: TrendsProps) {
  const { t } = useTranslation();
  const { state } = useQuery(() => api.garmin.activities(from, to), [from, to]);
  // Same shape/pattern as the current-period query above — comparison
  // activities for the trend charts. compareFrom/compareTo already carry
  // the same "previous period of equal length" default OverviewTab computes
  // when the caller doesn't pass an explicit compare window (see there).
  // Skipped entirely while comparison is switched off (same as OverviewTab's
  // own prevActivitiesQ) — no request, no per-sport comparison chart below.
  const compareQ = useQuery(
    () => compareEnabled ? api.garmin.activities(compareFrom, compareTo) : Promise.resolve([]),
    [compareFrom, compareTo, compareEnabled],
  );
  const { settings } = useSettings();
  const minGroupSize = settings?.min_trend_group_size ?? DEFAULT_MIN_TREND_GROUP_SIZE;
  const [groupMode, setGroupMode] = useState<GroupMode>(() => defaultGroupMode(from, to));
  useEffect(() => setGroupMode(defaultGroupMode(from, to)), [from, to]);
  // "Overlapping" (default) or "Distinct" — one shared toggle for every
  // sport's chart on this tab, only shown while comparison is enabled
  // (nothing to overlap/separate otherwise).
  const [viewMode, setViewMode] = useState<TrendViewMode>("overlap");

  // Memoized so its own reference is stable across renders that don't touch
  // `state` (e.g. a groupMode click) — otherwise the `? state.data : []`
  // ternary below builds a fresh [] every such render, which would make
  // sportsSorted's dependency on `activities` (below) look satisfied by
  // eslint-plugin-react-hooks while actually changing on every render.
  const activities = useMemo(() => (state.status === "success" ? state.data : []), [state]);
  const weekEnabled = new Set(activities.map(a => isoWeekStart(a.date_only))).size >= minGroupSize;
  const monthEnabled = new Set(activities.map(a => a.date_only.slice(0, 7))).size >= minGroupSize;
  // Real O(n) work (a Map build plus a sort with a reduce per comparison),
  // previously recomputed on every render including ones triggered by
  // unrelated state (e.g. clicking Week/Month) — memoized on `activities`
  // itself, which is now referentially stable across such renders (see
  // above). Called before the loading/error early returns below since hooks
  // must run unconditionally.
  const sportsSorted = useMemo(() => groupActivitiesBySport(activities), [activities]);

  // Comparison side, same memoization pattern as `activities`/`sportsSorted`
  // above — a Map (not the sorted array groupActivitiesBySport returns) is
  // all the render below needs: a per-sport lookup, keyed the same way, with
  // no comparison-side sort order of its own to matter (each sport renders
  // wherever the CURRENT side's sportsSorted places it).
  const compareActivities = useMemo(() => (compareQ.state.status === "success" ? compareQ.state.data : []), [compareQ.state]);
  const compareBySport = useMemo(() => new Map(groupActivitiesBySport(compareActivities)), [compareActivities]);

  // Downgrade out of a now-disabled mode (range shrank, or the auto-default
  // picked something the real data doesn't support) — only once data has
  // actually loaded, so a mode isn't prematurely downgraded while `activities`
  // is still the empty-during-loading placeholder.
  useEffect(() => {
    if (state.status !== "success") return;
    if (groupMode === "month" && !monthEnabled) setGroupMode(weekEnabled ? "week" : "single");
    else if (groupMode === "week" && !weekEnabled) setGroupMode("single");
  }, [state.status, groupMode, weekEnabled, monthEnabled]);

  if (state.status === "loading") return <LoadingSpinner />;
  if (state.status === "error")   return <ErrorBanner message={state.error} />;
  if (state.status !== "success" || state.data.length === 0) return null;

  const modeEnabled: Record<GroupMode, boolean> = { single: true, week: weekEnabled, month: monthEnabled };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <SectionTitle>{t("overview.trendSectionTitle", "Distance & pace/HR trend")}</SectionTitle>
        <div className="hra-row" style={{ gap: 8 }}>
          {compareEnabled && (
            <div className="hra-segmented-group">
              {(["overlap", "distinct"] as const).map(v => (
                <button key={v}
                  className={`hra-pill hra-nav-pill hra-nav-pill--sm hra-nav-hover ${viewMode === v ? "hra-pill-active" : ""}`}
                  onClick={() => setViewMode(v)}>
                  {v === "overlap" ? t("overview.view.overlap", "Overlapping") : t("overview.view.distinct", "Distinct")}
                </button>
              ))}
            </div>
          )}
          {/* One segmented container (polish pass) — a single bordered pill
              housing all three modes, rather than three independently-bordered
              buttons, so the group reads as one control. Inactive items are
              identical (no per-item border/background), only the active one
              gets the gradient pill; hover is the shared quiet bg-tint. */}
          <div className="hra-segmented-group">
            {GROUP_MODES.map(m => (
              <button key={m}
                className={`hra-pill hra-nav-pill hra-nav-pill--sm hra-nav-hover ${groupMode === m ? "hra-pill-active" : ""}`}
                onClick={() => setGroupMode(m)}
                disabled={!modeEnabled[m]}
                title={modeEnabled[m] ? undefined : t("overview.groupDisabledTooltip", `Needs at least ${minGroupSize} ${m}s in the selected range`, { count: minGroupSize, mode: m })}
                style={{
                  cursor: modeEnabled[m] ? "pointer" : "not-allowed",
                  opacity: modeEnabled[m] ? 1 : 0.4,
                }}>
                {t(`overview.group.${m}`, GROUP_LABEL[m])}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Week/month enable/disable above is still driven by the CURRENT
          period's data only — the comparison window has no vote over which
          modes are offered, only over what its own chart shows once a mode
          is picked (per-side "too few" gating is SportTrendPair's job now,
          not this map). */}
      {sportsSorted.map(([sport, acts]) => (
        <SportTrendPair key={sport} sport={sport} activities={acts}
          compareActivities={compareBySport.get(sport) ?? []}
          mode={groupMode} minGroupSize={minGroupSize} compareEnabled={compareEnabled}
          from={from} compareFrom={compareFrom} viewMode={viewMode} />
      ))}
    </>
  );
}

// ── Hero ring — the page's one signature visual (feature/temp-ui) ──────────
// A static (non-percentage) glowing ring framing the period's headline
// number. Deliberately not a progress/percentage gauge — this app has no
// "readiness" or goal concept to measure a fill against, so the ring reads
// as an instrument bezel around real totals rather than implying a target
// that doesn't exist. Distance/Time sit beside it as the same numbers
// already shown in the Total StatGrid below, just given one large, unmissable
// read before the grid breaks them out individually.

// Dual concentric rings, one per hero measurement (Activities/Distance/
// Time) — the inner ring is this period's share, the outer ring the
// previous period of equal length's share, BOTH normalized against
// whichever of the two is larger (that one draws a full circle, "100%");
// the smaller one draws its proportional arc against that same max. So the
// pair together always show which period "won" at a glance, not just two
// independent percentages. Gradient stroke is purely accent-derived — dark
// (--accent-strong) to light (--accent-light) — never a neutral/black
// stop, so it can't drift toward looking like a different, unrelated hue.
function DualRingGauge({
  id, current, previous, centerValue, unitLabel, comparisonText,
  size = 179, stroke = 12, gap = 7,
}: {
  id: string; current: number; previous: number | null;
  centerValue: string; unitLabel: string; comparisonText?: string | null;
  size?: number; stroke?: number; gap?: number;
}) {
  const max = Math.max(current, previous ?? 0, 0.0001);
  const innerPct = Math.max(0, Math.min(1, current / max));
  const outerPct = previous != null ? Math.max(0, Math.min(1, previous / max)) : 0;
  const rOuter = (size - stroke) / 2;
  const rInner = rOuter - stroke - gap;
  const c = size / 2;
  const dash = (r: number, pct: number) => {
    const circ = 2 * Math.PI * r;
    return `${circ * pct} ${circ}`;
  };
  return (
    // No .hra-tooltip class/data-tooltip here (removed) — the ring must
    // never show a hover tooltip, even an empty one: .hra-tooltip::after
    // always renders its bordered/padded box regardless of content, so an
    // empty data-tooltip would leave a visible blank bubble on hover. The
    // comparison figure is already shown inline (comparisonText below).
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
      <svg className="hra-hero-ring-glow" width={size} height={size}>
        <defs>
          <linearGradient id={`ringGrad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent-strong)" />
            <stop offset="100%" stopColor="var(--accent-light)" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={rOuter} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={rInner} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {/* Outer ring — previous period, fainter (a reference, not the headline) */}
        {previous != null && (
          <circle cx={c} cy={c} r={rOuter} fill="none" stroke={`url(#ringGrad-${id})`} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={dash(rOuter, outerPct)} strokeOpacity={0.5}
            transform={`rotate(-90 ${c} ${c})`} />
        )}
        {/* Inner ring — this period, full strength */}
        <circle cx={c} cy={c} r={rInner} fill="none" stroke={`url(#ringGrad-${id})`} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={dash(rInner, innerPct)}
          transform={`rotate(-90 ${c} ${c})`} />
        <text className="hra-ring-value" x={c} y={c - 3} textAnchor="middle">
          {centerValue}
        </text>
        <text x={c} y={c + size * 0.14} textAnchor="middle" fontSize={size * 0.065} letterSpacing="0.1em" fill="var(--text-muted)">
          {unitLabel}
        </text>
        {/* Previous-period value + delta — omitted entirely (not even an
            empty line) when there isn't enough previous-period data to
            compare against, per the "no comparison without data" rule; the
            caller decides that, this just renders whatever string it's
            given. */}
        {comparisonText && (
          <text className="hra-ring-compare" x={c} y={c + size * 0.14 + 14} textAnchor="middle">
            {comparisonText}
          </text>
        )}
      </svg>
    </div>
  );
}

// The one gate for "do not compare without enough previous data": null
// whenever there isn't a usable previous value — no fetch yet, an empty
// previous period, or a previous value of exactly 0 (a percentage against
// zero is undefined, not "∞%"/"N/A"). Every comparison below (ring text,
// Total/By-sport tooltips) goes through this.
function pctChange(current: number, previous: number | null): number | null {
  if (previous == null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

// "(previous value, ±N%)" for a ring's small comparison line. Module-level
// (not a component), so it goes through the i18next singleton directly
// rather than the useTranslation() hook — always called synchronously from
// PeriodHeroRing/OverviewTab's own render body, both of which already
// subscribe to language changes via their own t(), so this stays reactive.
function ringComparison(current: number, previous: number | null, fmt: (v: number) => string): string | null {
  const pct = pctChange(current, previous);
  if (pct == null) return null;
  const value = fmt(previous!), pctStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return i18next.t("overview.ringCompare", `(${value}, ${pctStr})`, { value, pct: pctStr });
}

// Same comparison, as a full sentence for a native `title` tooltip (Total
// StatGrid, By-sport rows) rather than a ring's compact bracketed line.
// `prefix` defaults to "vs previous period: " — the By-sport rows override it
// ("sessions: "/"HR: "/"pace: ") by passing their own translated prefix
// directly, rather than the old `.replace("vs previous period: ", ...)`
// post-processing, which only ever matched the literal English string and
// would silently no-op once this output is localized.
function comparisonTooltip(current: number, previous: number | null, fmt: (v: number) => string, prefix?: string): string | undefined {
  const pct = pctChange(current, previous);
  if (pct == null) return undefined;
  const p = prefix ?? i18next.t("overview.compareTooltip.defaultPrefix", "vs previous period: ");
  return `${p}${fmt(previous!)} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

function PeriodHeroRing({
  activities, prevActivities, km, prevKm, hours, prevHours, calories, prevCalories, title, linkedRace,
}: {
  activities: number; prevActivities: number | null;
  km: number; prevKm: number | null;
  hours: number; prevHours: number | null;
  calories: number; prevCalories: number | null;
  // Computed by the caller — "SUMMARY" alone with comparison off, or
  // "SUMMARY - {current label} vs {compare label}" with it on, where each
  // label is a linked named range's own name if one is selected for that
  // side, else the plain formatted date span. See OverviewTab's summaryTitle.
  title: string;
  // The race a "compare to" NAMED range is linked to (null when unlinked, or
  // the compare side isn't currently a named range at all) — shown as one
  // extra row at the end of the card, using the exact same ActivityRow the
  // Activities tab renders, incl. its expand/click behavior.
  linkedRace: ReactNode | null;
}) {
  const { t } = useTranslation();
  const distance = splitUnit(fmtKm(km * 1000));
  return (
    <>
      {/* Title sits OUTSIDE the card, same as every other section's
          SectionTitle above its content (Total/Running/By sport) — this
          card used to carry its own header inside the tinted panel, which
          read as though the whole section had gone missing since nothing
          above the panel announced it. */}
      <SectionTitle>{title}</SectionTitle>
      <Card className="hra-hero-tint" style={{ padding: "20px 24px", marginBottom: 20 }}>
        {/* justify-content: space-between — four rings spread evenly across
            the card's full width rather than clumping with a fixed gap.
            No `tooltip` on any ring — the comparison figure is already shown
            inline (comparisonText, the small bracketed line under the
            center value), so a hover tooltip would just repeat it. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 20 }}>
          <DualRingGauge id="acts" current={activities} previous={prevActivities} centerValue={String(activities)} unitLabel={t("overview.unit.activities", "ACTIVITIES")}
            comparisonText={ringComparison(activities, prevActivities, v => String(v))} />
          <DualRingGauge id="dist" current={km} previous={prevKm} centerValue={distance.main} unitLabel={distance.unit ?? t("overview.unit.km", "KM")}
            comparisonText={ringComparison(km, prevKm, v => fmtKm(v * 1000))} />
          <DualRingGauge id="time" current={hours} previous={prevHours} centerValue={hours.toFixed(1)} unitLabel={t("overview.unit.hours", "HOURS")}
            comparisonText={ringComparison(hours, prevHours, v => `${v.toFixed(1)} h`)} />
          <DualRingGauge id="cal" current={calories} previous={prevCalories} centerValue={String(Math.round(calories))} unitLabel={t("overview.unit.calories", "CALORIES")}
            comparisonText={ringComparison(calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`)} />
        </div>
        {linkedRace && (
          <div className="hra-border-top" style={{ marginTop: 16, paddingTop: 16 }}>
            {linkedRace}
          </div>
        )}
      </Card>
    </>
  );
}

// Reduces one sport's previous-period activities into the same shape its
// SportSummary counterpart exposes — shared by the Running section and the
// By-sport list below, both of which compare a live SportSummary against
// this same previous-period slice.
function prevSportStats(prevActs: Activity[]) {
  const hrs    = prevActs.map(a => a.avg_hr).filter((v): v is number => v != null);
  const paces  = prevActs.map(a => a.avg_pace_minkm).filter((v): v is number => v != null);
  const ascents = prevActs.map(a => a.ascent_m).filter((v): v is number => v != null);
  return {
    sessions: prevActs.length,
    km:      prevActs.reduce((s, a) => s + (a.distance_m ?? 0) / 1000, 0),
    avgHr:   hrs.length ? hrs.reduce((s, v) => s + v, 0) / hrs.length : null,
    avgPace: paces.length ? paces.reduce((s, v) => s + v, 0) / paces.length : null,
    ascent:  ascents.length ? ascents.reduce((s, v) => s + v, 0) : null,
  };
}

export function OverviewTab({ range, compareRange }: Props) {
  const { t } = useTranslation();
  const { from, to } = range;
  // The "compare to" range — powers every "vs previous period" comparison on
  // this tab (hero rings, Total tooltips, By-sport tooltips, AND each sport's
  // second trend chart), plus the linked-race lookup below. One fetch,
  // reused for all of them. useCompareRange keeps this in sync with `range`
  // on its own (see that hook's defaultCompareRange) — no fallback needed.
  const compareFrom = compareRange.from;
  const compareTo = compareRange.to;

  const { state } = useQuery(() => api.garmin.summary(from, to), [from, to]);
  const rangeQ = useQuery(() => api.garmin.range(), []);
  // Skipped entirely while the "Compare" switch is off (DateRangeBar) — no
  // request, no comparison data anywhere on this tab (rings, tooltips, each
  // sport's second trend chart, the linked-race row all key off this).
  const prevActivitiesQ = useQuery(
    () => compareRange.enabled ? api.garmin.activities(compareFrom, compareTo) : Promise.resolve([]),
    [compareFrom, compareTo, compareRange.enabled],
  );
  // Feeds DateRangeBar's two named-range dropdowns AND this tab's own
  // "compare-to is a linked race" detection below — one fetch, shared.
  const savedRangesQ = useQuery(() => api.dateRanges.list(), []);
  const savedRanges = savedRangesQ.state.status === "success" ? savedRangesQ.state.data : [];
  const { settings } = useSettings();
  const detailView = settings?.activity_detail_view ?? "accordion";

  // The saved range currently selected as "compare to" (same derivation
  // DateRangeBar itself uses for its own dropdown, HRA date-ranges-part-2) —
  // if it's linked to a race, that race is shown at the end of the Summary
  // card below, "exactly as if we were in the Activities tab." None while
  // comparison itself is switched off.
  const compareNamedRange = compareRange.enabled
    ? savedRanges.find(r => r.from_date === compareFrom && r.to_date === compareTo) : undefined;
  const linkedRaceId = compareNamedRange?.activity_id ?? null;
  const [raceExpanded, setRaceExpanded] = useState(false);
  const [raceModalOpen, setRaceModalOpen] = useState(false);
  const linkedRaceQ = useQuery(
    () => linkedRaceId != null ? api.garmin.activity(linkedRaceId) : Promise.resolve(null),
    [linkedRaceId],
  );
  const linkedRaceActivity = linkedRaceQ.state.status === "success" ? linkedRaceQ.state.data : null;

  // Summary card title: "SUMMARY" alone with comparison off; with it on,
  // "SUMMARY - {current} vs {compare}" where each side is its matching named
  // range's own name (same derivation as compareNamedRange above, applied to
  // Current too) if one is selected, else the plain formatted date span —
  // the REAL values, not a generic placeholder.
  const currentNamedRange = savedRanges.find(r => r.from_date === from && r.to_date === to);
  const currentLabel = currentNamedRange ? currentNamedRange.name : `${fmtDate(from)} → ${fmtDate(to)}`;
  const compareLabel = compareNamedRange ? compareNamedRange.name : `${fmtDate(compareFrom)} → ${fmtDate(compareTo)}`;
  const summaryTitle = compareRange.enabled
    ? t("overview.summaryTitleCompare", `SUMMARY - ${currentLabel} vs ${compareLabel}`, { current: currentLabel, compare: compareLabel })
    : t("overview.summaryTitle", "SUMMARY");

  const dateRangeBar = (
    <div style={{ marginBottom: 20 }}>
      <DateRangeBar {...range} compare={compareRange} savedRanges={savedRanges} />
    </div>
  );

  // DateRangeBar (+ its named-range rows) stays visible — and sticky, same
  // as the success case below — through loading/error/empty too, so the
  // range can still be changed out of any of those states.
  if (state.status === "loading") {
    return <><div className="hra-sticky-summary">{dateRangeBar}</div><LoadingSpinner /></>;
  }
  if (state.status === "error") {
    return <><div className="hra-sticky-summary">{dateRangeBar}</div><ErrorBanner message={state.error} /></>;
  }
  if (state.status !== "success") return null;

  const sports = state.data;
  if (sports.length === 0) {
    const rangeMinMax = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return (
      <>
        <div className="hra-sticky-summary">{dateRangeBar}</div>
        <RangeEmpty range={rangeMinMax} from={from} to={to} entityLabel={t("common.entity.activities", "activities")} />
      </>
    );
  }

  const totals = sports.reduce(
    (acc, s) => ({
      acts:     acc.acts     + s.total_activities,
      km:       acc.km       + (s.total_km    ?? 0),
      hours:    acc.hours    + (s.total_hours ?? 0),
      calories: acc.calories + (s.total_calories ?? 0),
      ascent:   acc.ascent   + (s.total_ascent ?? 0),
    }),
    { acts: 0, km: 0, hours: 0, calories: 0, ascent: 0 }
  );

  const run = sports.find(s => s.sport === "running");
  // Previous-period totals for the hero rings' outer ring + every tooltip
  // below — duration_sec/3600 and ascent_m mirror exactly how the backend
  // computes total_hours/total_ascent (SUM(...)/3600, see activities.repo.ts)
  // — there's no summary endpoint for an arbitrary (previous) range, only
  // the raw activity list. "Enough previous data" (per the no-comparison
  // rule) means the previous period actually has activities in it — an
  // empty previous period suppresses every comparison on this tab, not
  // just the ones that would divide by zero.
  const prevActivities = prevActivitiesQ.state.status === "success" ? prevActivitiesQ.state.data : [];
  const hasPrevData = prevActivities.length > 0;
  const prevActs      = hasPrevData ? prevActivities.length : null;
  const prevKm         = hasPrevData ? prevActivities.reduce((s, a) => s + (a.distance_m ?? 0) / 1000, 0) : null;
  const prevHours       = hasPrevData ? prevActivities.reduce((s, a) => s + (a.duration_sec ?? 0) / 3600, 0) : null;
  const prevCalories = hasPrevData ? prevActivities.reduce((s, a) => s + (a.calories ?? 0), 0) : null;
  const prevAscent   = hasPrevData ? prevActivities.reduce((s, a) => s + (a.ascent_m ?? 0), 0) : null;
  const prevBySport = new Map(groupActivitiesBySport(prevActivities));

  const linkedRaceRow: ReactNode = linkedRaceActivity ? (
    <ActivityRow
      activity={linkedRaceActivity}
      expanded={detailView === "accordion" && raceExpanded}
      expandIndicator={detailView}
      onClick={() => detailView === "accordion" ? setRaceExpanded(e => !e) : setRaceModalOpen(true)}
      expandedContent={
        <ActivityDetailBody activityId={linkedRaceActivity.id} onDelete={() => setRaceExpanded(false)} />
      }
    />
  ) : null;

  return (
    <>
      <div className="hra-sticky-summary">
        {dateRangeBar}
        <PeriodHeroRing
          activities={totals.acts} prevActivities={prevActs}
          km={totals.km} prevKm={prevKm}
          hours={totals.hours} prevHours={prevHours}
          calories={totals.calories} prevCalories={prevCalories}
          title={summaryTitle}
          linkedRace={linkedRaceRow}
        />
      </div>

      <SectionTitle>{t("overview.totalSectionTitle", "Total")}</SectionTitle>
      <StatGrid>
        <Stat label={t("overview.stat.activities", "Activities")} value={totals.acts} tooltip={comparisonTooltip(totals.acts, prevActs, v => String(v))} />
        <Stat label={t("overview.stat.distance", "Distance")} value={fmtKm(totals.km * 1000)} accent="var(--accent-green)"
          tooltip={comparisonTooltip(totals.km, prevKm, v => fmtKm(v * 1000))} />
        <Stat label={t("overview.stat.time", "Time")} value={`${totals.hours.toFixed(1)} h`}
          tooltip={comparisonTooltip(totals.hours, prevHours, v => `${v.toFixed(1)} h`)} />
        {totals.calories > 0 && (
          <Stat label={t("overview.stat.calories", "Calories")} value={`${totals.calories.toLocaleString()} kcal`}
            tooltip={comparisonTooltip(totals.calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`)} />
        )}
        {totals.ascent > 0 && (
          <Stat label={t("overview.stat.elevationGain", "Elevation gain")} value={fmtElevation(totals.ascent)}
            tooltip={comparisonTooltip(totals.ascent, prevAscent, v => fmtElevation(v))} />
        )}
      </StatGrid>

      {run && (() => {
        const prevRun = prevSportStats(prevBySport.get(run.sport ?? "other") ?? []);
        return (
          <>
            <SectionTitle>{t("overview.runningSectionTitle", "Running")}</SectionTitle>
            <StatGrid>
              <Stat label={t("overview.stat.sessions", "Sessions")} value={run.total_activities}
                tooltip={comparisonTooltip(run.total_activities, prevRun.sessions || null, v => String(v))} />
              <Stat label={t("overview.stat.distance", "Distance")} value={fmtKm(run.total_km * 1000)} accent="var(--accent-green)"
                tooltip={comparisonTooltip(run.total_km, prevRun.km || null, v => fmtKm(v * 1000))} />
              {run.avg_hr && (
                <Stat label={t("overview.stat.avgHr", "Avg HR")} value={`${run.avg_hr} bpm`} accent="var(--accent-red)"
                  tooltip={comparisonTooltip(run.avg_hr, prevRun.avgHr, v => `${Math.round(v)} bpm`)} />
              )}
              {run.avg_pace && (
                <Stat label={t("overview.stat.avgPace", "Avg pace")} value={fmtPace(run.avg_pace)} sub={paceUnitLabel()}
                  tooltip={comparisonTooltip(run.avg_pace, prevRun.avgPace, v => `${fmtPace(v)}/${distanceUnitLabel()}`)} />
              )}
              {run.total_ascent && (
                <Stat label={t("overview.stat.elevation", "Elevation")} value={fmtElevation(run.total_ascent)}
                  tooltip={comparisonTooltip(run.total_ascent, prevRun.ascent, v => fmtElevation(v))} />
              )}
            </StatGrid>
          </>
        );
      })()}

      {sports.length > 1 && (
        <>
          <SectionTitle>{t("overview.bySportSectionTitle", "By sport")}</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {sports.map(s => {
              const prevSport = prevSportStats(prevBySport.get(s.sport ?? "other") ?? []);
              // One combined tooltip covering every comparable figure on the
              // row, not a separate title per span — a sport row has no room
              // for four individual tooltip targets the way the Total
              // StatGrid's cards do.
              const tooltip = [
                comparisonTooltip(s.total_km, prevSport.km || null, v => fmtKm(v * 1000)),
                comparisonTooltip(s.total_activities, prevSport.sessions || null, v => String(v), t("overview.compareTooltip.sessionsPrefix", "sessions: ")),
                s.avg_hr != null ? comparisonTooltip(s.avg_hr, prevSport.avgHr, v => `${Math.round(v)} bpm`, t("overview.compareTooltip.hrPrefix", "HR: ")) : undefined,
                s.avg_pace != null ? comparisonTooltip(s.avg_pace, prevSport.avgPace, v => `${fmtPace(v)}/${distanceUnitLabel()}`, t("overview.compareTooltip.pacePrefix", "pace: ")) : undefined,
              ].filter(Boolean).join(" · ") || undefined;
              return (
                <Card
                  key={s.sport}
                  tooltip={tooltip}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", fontSize: 14 }}
                >
                  <Badge label={s.sport ?? "other"} color={SPORT_COLOR[s.sport ?? "other"] ?? "#888"} />
                  <span className="hra-text-primary" style={{ flex: 1, fontWeight: 500 }}>
                    {fmtKm(s.total_km * 1000)}
                  </span>
                  <span className="hra-text-secondary">{t("overview.bySportSessionsLabel", `${s.total_activities} sessions`, { count: s.total_activities })}</span>
                  {s.avg_hr && (
                    <span className="hra-text-danger" style={{ fontSize: 13 }}>♥ {s.avg_hr}</span>
                  )}
                  {s.avg_pace && (
                    <span className="hra-text-muted" style={{ fontSize: 13 }}>{fmtPace(s.avg_pace)}/{distanceUnitLabel()}</span>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <TrendsBySport from={from} to={to} compareFrom={compareFrom} compareTo={compareTo} compareEnabled={compareRange.enabled} />

      {raceModalOpen && linkedRaceActivity && (
        <ActivityModal
          activityId={linkedRaceActivity.id}
          onClose={() => setRaceModalOpen(false)}
          onDelete={() => setRaceModalOpen(false)}
        />
      )}
    </>
  );
}
