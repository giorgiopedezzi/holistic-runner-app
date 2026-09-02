import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { MapPin, Timer, Flame, Gauge, Heart } from "lucide-react";
import { RunnerGlyph } from "@/components/activity/RunnerGlyph";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { useUrlState } from "@/hooks/useUrlState";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { CompareRangeState } from "@/hooks/useCompareRange";
import { api } from "@/api/client";
import {
  Card, ChartCard, chartGrid, chartTick,
  Stat, SectionTitle, Empty, ErrorBanner, LoadingSpinner, Badge, RangeEmpty,
  splitUnit, GraphKpiCard,
} from "@/components/ui";
import { DateRangeBar } from "@/components/DateRangeBar";
import { ActivityRow } from "@/components/activity/ActivityRow";
import { ActivityModal, ActivityDetailBody } from "@/components/ActivityModal";
import { SPORT_COLOR, type Activity, type SavedDateRange, type SportSummary } from "@/types/api";
import { fmtPace, fmtKm, fmtMinSecRaw, fmtDate } from "@/utils/fmt";
import { getUnitSystem, kmToMi, paceKmToMi, distanceUnitLabel, paceUnitLabel } from "@/utils/units";
import { getResolvedTheme } from "@/utils/theme";
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
  // Fetched once at the App shell level (not remounted per tab switch, so
  // one fetch for the whole session) and passed down here instead of this
  // tab fetching its own copy — same list DateRangeBar now shares with
  // Activities/Body's bar and Manage's sync sections.
  savedRanges: SavedDateRange[];
}

// ── Distance/pace/HR trend, one chart per sport ─────────────────────────────
// Bars are total distance per group (one activity per bar in "single" mode,
// summed across the group in "week"/"month" mode); the pace and HR lines
// connect one point per bar, at that bar's x position — Recharts' default
// categorical-axis behavior already centers Bar and Line data at the same x
// tick, so no manual positioning is needed for "starts from the horizontal
// center of the bar."
const GROUP_MODES: GroupMode[] = ["single", "week", "month"];
const GROUP_LABEL: Record<GroupMode, string> = { single: "By activity", week: "By week", month: "By month" };
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

// Shared axis widths — ONE source of truth used both by the YAxis `width`
// props below AND by the primary graph's header-row padding, so the
// Current/Compare label lines up with the first bar's left edge and the
// right-legend cluster lines up with the last bar's right edge (explicit
// feedback). Km+pace stack on the left, HR alone on the right.
// Back to their original (pre-rotated-title) widths — the Y-axis vertical
// titles were removed per explicit feedback ("remove Y axis legend").
const KM_AXIS_WIDTH = 32;
const PACE_AXIS_WIDTH = 34;
const HR_AXIS_WIDTH = 30;
const LEFT_AXES_WIDTH = KM_AXIS_WIDTH + PACE_AXIS_WIDTH;
// ChartCard's own header rows already carry 8px of horizontal padding
// (index.css) — these are the ADDITIONAL amounts needed on top of that to
// reach the full axis width.
const HEADER_EXTRA_LEFT = LEFT_AXES_WIDTH - 8;
const HEADER_EXTRA_RIGHT = HR_AXIS_WIDTH - 8;

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
function SportTrendChart({ sport, points, title, kmDomain, paceDomain, hrDomain, size, legend, controlsRow, subHeader }: {
  sport: string; title: ReactNode;
  points: { label: string; totalKm: number; avgPace: number | null; avgHr: number | null }[];
  kmDomain: [number, number]; paceDomain: [number, number]; hrDomain: [number, number];
  // "lg" (primary/running graph) — now the SAME size as the compare card too
  // (explicit feedback: "make the two graphs identical") / default unchanged
  // (every other sport, exactly as before this Story) — additive, no
  // behavior change unless a caller opts in.
  size?: "lg" | "sm";
  // Row 1 (beside title), the controls row, and row 2 (above the chart) —
  // see ChartCard's own doc comment for why these are three separate slots.
  legend?: ReactNode;
  controlsRow?: ReactNode;
  subHeader?: ReactNode;
}) {
  const { t } = useTranslation();
  const isSwimming = sport === "swimming";
  const imperial = getUnitSystem() === "imperial";
  const paceUnit = isSwimming ? "/100m" : (imperial ? "/mi" : "/km");
  const distanceUnit = distanceUnitLabel();
  const hrColor = "var(--data-hr)"; // fixed semantic data color (HRA-94/97) — was --accent-red, same hex today
  const gradId = useId();
  const interval = sampleInterval(points.length);
  const height = size === "lg" ? 460 : size === "sm" ? 160 : 220;

  return (
    <div className="mb-3">
      <ChartCard title={title} legend={legend} controlsRow={controlsRow} subHeader={subHeader && (
        <div className="hra-overview-header-inset" style={{ "--overview-header-left": `${HEADER_EXTRA_LEFT}px` } as CSSProperties}>{subHeader}</div>
      )}>
      <ResponsiveContainer width="100%" height={height}>
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
          <YAxis yAxisId="km" domain={kmDomain} tick={{ fill: BAR_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={KM_AXIS_WIDTH}
            tickFormatter={(v: number) => v.toFixed(0)} />
          <YAxis yAxisId="pace" orientation="left" domain={paceDomain} reversed
            tick={{ fill: PACE_LINE_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={PACE_AXIS_WIDTH}
            tickFormatter={(v: number) => fmtMinSecRaw(v)} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain}
            tick={{ fill: hrColor, fontSize: 9 }} tickLine={false} axisLine={false} width={HR_AXIS_WIDTH}
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
                <div className="hra-chart-tooltip hra-col gap-0.5">
                  <span className="hra-chart-tooltip-label">{label}</span>
                  <div className="hra-row gap-1.5">
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
function SportTrendOverlapChart({ sport, title, points, compareEnabled, kmDomain, paceDomain, hrDomain, size, legend, controlsRow, subHeader }: {
  sport: string; title: ReactNode; points: OverlapPoint[]; compareEnabled: boolean;
  kmDomain: [number, number]; paceDomain: [number, number]; hrDomain: [number, number];
  size?: "lg" | "sm";
  // Row 1 (beside title) and the controls row — passed straight through to
  // ChartCard, unlike the Current/Compare swatch group below (this
  // component's own concern, since only it knows `compareEnabled`), which
  // always lands in row 2 alongside the caller's `subHeader`.
  legend?: ReactNode;
  controlsRow?: ReactNode;
  subHeader?: ReactNode;
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
  const height = size === "lg" ? 460 : size === "sm" ? 160 : 220;
  // Aligned to the first bar's left edge (explicit feedback) via the SAME
  // HEADER_EXTRA_LEFT the YAxis `width` props below use. Compact: one label
  // per metric, then its two swatches side by side — not six separately
  // labelled "(current)"/"(previous)" chips (explicit feedback: "to compact
  // graph legend, show Distance: current [representation] compared
  // [representation]... same for the others"). This REPLACES the plain
  // graph legend (Avg pace/Avg HR) while overlapping — showing both would
  // be redundant, since this one already identifies every curve AND
  // distinguishes current-vs-previous in one place (explicit feedback:
  // "when overlap, remove the original legend"). The muted swatch is now
  // the ONLY visual difference from current (no dash) — the real chart
  // lines were changed to match this (explicit feedback: "I prefer the
  // mute color being the real representation," i.e. the chart follows the
  // legend, not the other way around).
  const currentCompareLegend = compareEnabled && (
    <div className="hra-text-muted flex gap-3.5 items-center text-meta flex-wrap">
      {([
        [t("overview.stat.distance", "Distance"), "var(--data-pace)", "bar"],
        [t("overview.stat.avgPace", "Avg pace"), PACE_LINE_COLOR, "line"],
        [t("overview.stat.avgHr", "Avg HR"), hrColor, "line"],
      ] as const).map(([metricLabel, color, kind]) => (
        <span key={metricLabel} className="hra-row-inline gap-1.5">
          {metricLabel}:
          <span className="hra-row-inline" style={{ "--legend-color": color } as CSSProperties} title={t("overview.legend.current", "current")}>
            <span className={kind === "bar" ? "hra-series-swatch--bar" : "hra-series-swatch--line"} />
          </span>
          <span className="hra-row-inline opacity-50" style={{ "--legend-color": color } as CSSProperties} title={t("overview.legend.previous", "previous")}>
            <span className={kind === "bar" ? "hra-series-swatch--bar" : "hra-series-swatch--line"} />
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="hra-overlap-card-enter mb-3">
      <ChartCard title={title} legend={legend} controlsRow={controlsRow} subHeader={(currentCompareLegend || subHeader) && (
        <div className="hra-overview-header-inset flex gap-4 items-center flex-wrap" style={{ "--overview-header-left": `${HEADER_EXTRA_LEFT}px` } as CSSProperties}>
          {currentCompareLegend || subHeader}
        </div>
      )}>
      <ResponsiveContainer width="100%" height={height}>
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
          <YAxis yAxisId="km" domain={kmDomain} tick={{ fill: BAR_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={KM_AXIS_WIDTH}
            tickFormatter={(v: number) => v.toFixed(0)} />
          <YAxis yAxisId="pace" orientation="left" domain={paceDomain} reversed
            tick={{ fill: PACE_LINE_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={PACE_AXIS_WIDTH}
            tickFormatter={(v: number) => fmtMinSecRaw(v)} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain}
            tick={{ fill: hrColor, fontSize: 9 }} tickLine={false} axisLine={false} width={HR_AXIS_WIDTH}
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
                <div className="hra-row gap-1.5">
                  {km != null && <span className="hra-chart-tooltip-km">{km.toFixed(1)} {distanceUnit}</span>}
                  {pace != null && <>{km != null && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-pace">{t("overview.chartTooltip.pace", "pace")} {fmtMinSecRaw(pace)}{paceUnit}</span></>}
                  {hr != null && <>{(km != null || pace != null) && <span className="hra-chart-tooltip-sep">·</span>}<span className="hra-chart-tooltip-hr">{t("overview.chartTooltip.hr", "HR")} {Math.round(hr)}</span></>}
                </div>
              );
              return (
                <div className="hra-chart-tooltip hra-col gap-1.5">
                  {p.currentLabel != null && (
                    <div className="flex flex-col gap-0.5">
                      <span className="hra-chart-tooltip-label">{p.currentLabel}</span>
                      {metricsRow(p.currentKm, p.currentPace, p.currentHr)}
                    </div>
                  )}
                  {compareEnabled && p.compareLabel != null && (
                    <div className="flex flex-col gap-0.5 opacity-75">
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
          {/* Muted color only — no dash pattern (explicit feedback: "I
              prefer the mute color being the real representation," i.e. the
              actual chart should match the compact legend's muted swatch,
              not the other way around). */}
          {compareEnabled && (
            <Line xAxisId="xMain" yAxisId="pace" dataKey="comparePace" name="Compare Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2}
              strokeOpacity={0.55} dot={{ r: 2, fill: PACE_LINE_COLOR, strokeWidth: 0, fillOpacity: 0.55 }}
              connectNulls isAnimationActive={false} />
          )}
          <Line xAxisId="xMain" yAxisId="hr" dataKey="currentHr" name="Avg HR" stroke={hrColor} strokeWidth={2.5}
            className="hra-trend-line-hr" dot={{ r: 2.5, fill: hrColor, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: hrColor, stroke: "var(--bg-card)", strokeWidth: 2 }}
            connectNulls isAnimationActive={false} />
          {compareEnabled && (
            <Line xAxisId="xMain" yAxisId="hr" dataKey="compareHr" name="Compare Avg HR" stroke={hrColor} strokeWidth={2}
              strokeOpacity={0.55} dot={{ r: 2, fill: hrColor, strokeWidth: 0, fillOpacity: 0.55 }}
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
// i18n'd series-identification legend (Distance/Avg pace/Avg HR) — the main
// trend graph's bars/lines had color alone to identify them before this;
// added per explicit feedback ("add i18n legend for the axis: distanza,
// fc..") alongside the graph-first reorg. Swatch colors are the same fixed
// semantic tokens the chart itself draws with (PACE_LINE_COLOR/hrColor/
// BAR_COLOR-as-drawn — the bar's own gradient reads as --data-pace at low
// opacity, so its legend swatch uses that same hue, not the neutral
// BAR_COLOR used for its axis ticks).
// "Graph legend" (explicit feedback: distinct from the "axis legend"/KPI
// cluster) — identifies the CURVES themselves ("the meaning of the curve"),
// left-aligned. Distance is deliberately omitted: it's drawn as plain bars,
// self-evident without a legend entry — only the two LINES (pace, HR) need
// one, since color alone doesn't distinguish them from each other or from
// their own current-vs-compare dashed/solid variants.
function TrendSeriesLegend({ paceUnit }: { paceUnit: string }) {
  const { t } = useTranslation();
  const items: [string, string][] = [
    [t("overview.legend.paceAxis", `Avg pace (${paceUnit})`, { unit: paceUnit }), PACE_LINE_COLOR],
    [t("overview.legend.hrAxis", "Avg HR (bpm)"), "var(--data-hr)"],
  ];
  return (
    <div className="hra-text-muted flex gap-3 items-center text-meta flex-wrap">
      {items.map(([label, color]) => (
        <span key={label} className="hra-row-inline" style={{ "--legend-color": color } as CSSProperties}>
          <span className="hra-series-swatch--line" />
          {label}
        </span>
      ))}
    </div>
  );
}

// Compact KPI card for the main graph's own header row — deliberately
// smaller/plainer than the shared `Stat` card used by Other key metrics,
// which is sized to stand on its own in a grid, not to sit inline beside a
function SportTrendPair({ sport, activities, compareActivities, mode, minGroupSize, compareEnabled, from, to, compareFrom, compareTo, viewMode, primary, headerControls, kpis, compareKpis, otherKeyMetrics, compareOtherKeyMetrics }: {
  sport: string; activities: Activity[]; compareActivities: Activity[]; mode: GroupMode; minGroupSize: number;
  compareEnabled: boolean; from: string; to: string; compareFrom: string; compareTo: string; viewMode: TrendViewMode;
  // Graph-first reorg: the one sport (running) singled out as the page's
  // main/comparison graph pair gets larger charts + the series legend + the
  // mode-toggle controls folded into its own card header, instead of a
  // shared header above the whole sports list. Every other sport keeps the
  // exact pre-existing layout (primary/headerControls/kpis all omitted).
  primary?: boolean;
  headerControls?: ReactNode;
  // Total distance / Avg pace mini cards for the CURRENT period — rendered
  // into the current/overlap chart's own controls row, only when primary.
  kpis?: ReactNode;
  // Same, but the COMPARE period's own totals (no delta — there's nothing
  // further back to compare a reference period against) — explicit
  // feedback: "even the second graph must have 'other metrics badges'."
  // Rendered into the compare card's own badges-only row (no switches
  // there, per separate explicit feedback).
  compareKpis?: ReactNode;
  // "Other key metrics" sidebar — now shown beside BOTH graphs in distinct
  // mode, not just the first one (explicit feedback: "add the other key
  // metrics badges aside the second graph[] too"), so it's placed HERE
  // (inside the per-graph render) rather than wrapped once around this
  // whole component by the caller. `otherKeyMetrics` = current period's
  // figures (beside the current chart); `compareOtherKeyMetrics` = the
  // compare period's own figures (beside the compare card) — explicit
  // feedback: "data in the Other metric of the second graph must be the
  // data of the second graph," not a repeat of the first.
  otherKeyMetrics?: ReactNode;
  compareOtherKeyMetrics?: ReactNode;
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

  const isSwimmingUnit = sport === "swimming";
  // The align-mode toggle (Match order/Match by time) — same segmented-pill
  // visual as the overlap/distinct and single/week/month controls (explicit
  // feedback: "no reason to have match order/match by time visually
  // different from overlapping/distinct"), not its own bespoke style.
  const alignToggle = countsDiffer ? (
    <div className="hra-segment"
      title={t("overview.alignTooltip", "The two periods have a different number of activities — pick how to line them up")}>
      {([["index", "Match order"], ["time", "Match by time"]] as const).map(([m, l]) => (
        <button key={m} onClick={() => setAlignMode(m)}
          className="hra-segment-item" data-active={alignMode === m}>
          {t(`overview.align.${m}`, l)}
        </button>
      ))}
    </div>
  ) : null;

  // Row 0 (own row, above the switches/pills — explicit feedback): icon +
  // "{Sport} – Andamento distanza e ritmo" + the period. Built for BOTH the
  // primary current chart and (identically, just with the compare period)
  // the primary compare chart in distinct mode — explicit feedback: "the
  // comparison graph MUST BE IDENTICAL to the current one when it's
  // distinct... match order/match by time, overlapping/distinct, single/
  // week/month miss on comparison graph" — so this is now a function of
  // which period to show, not a single fixed value. Overlap mode's single
  // merged chart still gets "current PLUS vs {compare period}" appended, as
  // before. Sport name goes through a small dedicated `sport.*` key set (not
  // the app-wide sport-enum translation, which CLAUDE.md documents as a
  // known, deliberately out-of-scope gap elsewhere) — this title is
  // prominent enough, and new enough, that leaving half of it hardcoded
  // English would be a regression introduced by this Story, not an existing
  // gap. Named-range names aren't threaded this deep (savedRanges lives
  // several components up) — a plain date span is used instead.
  const periodLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
  const comparePeriodLabel = `${fmtDate(compareFrom)} – ${fmtDate(compareTo)}`;
  const overlapTitlePeriod = compareEnabled && viewMode === "overlap"
    ? t("overview.mainGraphPeriodCompare", `${periodLabel} vs ${comparePeriodLabel}`, { current: periodLabel, compare: comparePeriodLabel })
    : periodLabel;
  const buildGraphTitle = (period: string) => (
    <span className="hra-row-inline gap-2 text-body font-semibold flex-wrap">
      <RunnerGlyph pose="a" color="var(--accent)" size={20} />
      <span className="hra-text-primary">
        {t("overview.mainGraphTitle", `${t(`sport.${sport}`, label)} – Andamento distanza e ritmo`, { sport: t(`sport.${sport}`, label) })}
      </span>
      <span className="hra-text-muted text-meta font-normal">({period})</span>
    </span>
  );
  const graphTitle = primary ? buildGraphTitle(overlapTitlePeriod) : undefined;
  const compareGraphTitle = primary ? buildGraphTitle(comparePeriodLabel) : undefined;
  // Row 1 (own row, below the title, fixed position — explicit feedback:
  // the KPI badges "are ok" where they sit content-wise, but must "move
  // higher to align their top to the top of the switches... so the whole
  // UI won't move when overlaps [only the chart grows taller]"): mode
  // controls + align toggle on the left, the Distance/Avg-pace value cards
  // on the right, all in ONE row that never changes height regardless of
  // view mode. No "⋯" more button — removed per earlier explicit feedback.
  const graphControlsRow = primary ? (
    // Right-padded to the same HEADER_EXTRA_RIGHT the YAxis `width` below
    // uses, so the KPI cards' right edge still lines up with the last bar
    // (explicit feedback, carried over from when these lived in a separate
    // row) even though they've moved up to share this one with the pills.
    <div className="hra-overview-controls-row flex justify-between items-center flex-wrap gap-2" style={{ "--overview-header-right": `${HEADER_EXTRA_RIGHT}px` } as CSSProperties}>
      <div className="hra-row-inline gap-2">
        {alignToggle}
        {headerControls}
      </div>
      {kpis && <div className="flex gap-2 shrink-0">{kpis}</div>}
    </div>
  ) : undefined;
  // Row 2 (subHeader) for the CURRENT/overlap chart: the "graph legend" —
  // Avg pace / Avg HR curve identity, left-aligned (explicit feedback:
  // distinct from the row-1 KPI cluster, which is a different concern —
  // "axis legend" values). Padding to align with the first bar's left edge
  // is applied where this is consumed (SportTrendChart/SportTrendOverlapChart),
  // same as before.
  const subHeader = primary ? (
    <TrendSeriesLegend paceUnit={isSwimmingUnit ? "/100m" : paceUnitLabel()} />
  ) : undefined;
  // Compare card's own equivalent row — badges + its OWN copy of the graph
  // legend sharing one row (dashboard design-system rework: "put graph
  // legends in the same row of the widget in the compared to graph"), no
  // switches (explicit feedback, separately: the compare card must show its
  // own totals but must NOT show the mode-toggle pills). Unlike the primary
  // chart's own two-row header (graphControlsRow's pills leave no spare room
  // for the legend beside the KPI cards), this row only ever holds
  // legend+badges, so it fits both without wrapping.
  const compareBadgesRow = primary && (subHeader || compareKpis) ? (
    <div className="hra-overview-controls-row flex justify-between items-center flex-wrap gap-2" style={{ "--overview-header-right": `${HEADER_EXTRA_RIGHT}px` } as CSSProperties}>
      {subHeader}
      {compareKpis && <div className="flex gap-2 shrink-0">{compareKpis}</div>}
    </div>
  ) : undefined;

  return (
    <div className="mb-5">
      {/* Badge + activity-count row — every other sport's original header,
          unchanged. The primary graph replaces this entirely with its own
          title/controls rows (graphTitle/graphControlsRow above), per the
          exact-layout spec: nothing besides those two rows sits between the
          filters and the graph. */}
      {!primary && (
        <div className="hra-control-row gap-2.5 mb-2">
          <Badge label={sport} color={SPORT_COLOR[getResolvedTheme()][sport] ?? "#888"} />
          <span className="hra-text-muted text-meta">
            {compareEnabled
              ? t("overview.sportCounts.withCompare", `${curPoints.length} current ${nounLabel} · ${cmpPoints.length} compare ${nounLabel}`, { count: curPoints.length, noun: nounLabel, compareCount: cmpPoints.length })
              : t("overview.sportCounts.base", `${curPoints.length} current ${nounLabel}`, { count: curPoints.length, noun: nounLabel })}
          </span>
          {alignToggle}
        </div>
      )}

      {tooFew(activities) ? (
        // Primary keeps its own title/controls/KPI header even when there's
        // too little data for an actual trend line — the period's total
        // distance/avg pace are still well-defined with just 1-4 activities,
        // only the multi-point TREND chart isn't. Losing the KPI cards here
        // would make them vanish silently below the grouping threshold.
        primary ? (
          <ChartCard title={graphTitle} controlsRow={graphControlsRow} subHeader={subHeader}>
            <Empty message={t("overview.tooFewCurrent", `Too few ${sport} activities to determine a trend (${activities.length} of ${minGroupSize} needed).`, { sport, count: activities.length, min: minGroupSize })} />
          </ChartCard>
        ) : (
          <Empty message={t("overview.tooFewCurrent", `Too few ${sport} activities to determine a trend (${activities.length} of ${minGroupSize} needed).`, { sport, count: activities.length, min: minGroupSize })} />
        )
      ) : (() => {
        const currentChart = (
          <SportTrendChart sport={sport} title={primary ? graphTitle : `${label} - current`} points={scaledCur}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain}
            size={primary ? "lg" : undefined} controlsRow={graphControlsRow} subHeader={subHeader} />
        );
        // Same size as the current chart, and its own title (with the
        // COMPARE period) + graph legend — but explicitly NO controls row
        // (explicit feedback: "when distinct is chosen, the second graph
        // MUST NOT HAVE switches [match order/match by time, overlapping/
        // distinct, single/week/month]" — those only ever apply to the
        // shared state one control surface should own, not two). It DOES
        // get the graph legend though (explicit feedback: "the second graph
        // MUST have graph legend [avg HR, avg pace]").
        const compareCard = !compareEnabled ? null : tooFew(compareActivities) ? (
          primary ? (
            <ChartCard title={compareGraphTitle} controlsRow={compareBadgesRow}>
              <Empty message={t("overview.tooFewCompare", `Too few ${sport} activities in the compare range to determine a trend (${compareActivities.length} of ${minGroupSize} needed).`, { sport, count: compareActivities.length, min: minGroupSize })} />
            </ChartCard>
          ) : (
            <Empty message={t("overview.tooFewCompare", `Too few ${sport} activities in the compare range to determine a trend (${compareActivities.length} of ${minGroupSize} needed).`, { sport, count: compareActivities.length, min: minGroupSize })} />
          )
        ) : (
          <SportTrendChart sport={sport} title={primary ? compareGraphTitle : `${label} - comparison`} points={scaledCmp}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain}
            size={primary ? "lg" : undefined} controlsRow={compareBadgesRow} />
        );
        const overlapChart = (
          <SportTrendOverlapChart sport={sport} title={primary ? graphTitle : label} points={scaledOverlap} compareEnabled={compareEnabled}
            kmDomain={kmDomain} paceDomain={paceDomain} hrDomain={hrDomain}
            size={primary ? "lg" : undefined} controlsRow={graphControlsRow} subHeader={subHeader} />
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
          <div className="relative">
            {currentChart}
            {compareCard && <div className={overlayClass}>{compareCard}</div>}
          </div>
        );

        // Places "Other key metrics" beside a graph, not just above/below
        // the whole pair (explicit feedback: "add the other key metrics
        // badges aside the second graph[] too"). Reuses the identical
        // flex-basis/max-width pair for every row it wraps, so however many
        // times it's called, each row independently fits the container's
        // own width — flexbox always sizes to its parent, so repeating the
        // same proportions can't make a row wider than the one before it.
        // `sidebar` defaults to the CURRENT period's figures — callers
        // wrapping the compare card pass `compareOtherKeyMetrics` explicitly
        // (explicit feedback: "data in the Other metric of the second graph
        // must be the data of the second graph," not a repeat of the first).
        const withSidebar = (graph: ReactNode, sidebar: ReactNode = otherKeyMetrics) => primary && sidebar ? (
          <div className="hra-trend-layout">
            <div className="hra-trend-main">{graph}</div>
            <div className="hra-trend-sidebar flex flex-col gap-2.5">
              {sidebar}
            </div>
          </div>
        ) : graph;

        switch (phase) {
          case "overlap":
            return withSidebar(overlapChart);
          case "distinct":
            return (
              <>
                {withSidebar(currentChart)}
                {compareCard && <div className="hra-section-gap-top">{withSidebar(compareCard, compareOtherKeyMetrics)}</div>}
              </>
            );
          case "d2o-move":
            // Compare card slides up (still in normal flow, so it briefly
            // leaves dead space below it) until it visually overlaps
            // current — the merged look `d2o-fade` picks up from. Each
            // graph keeps its OWN badges wrapped alongside it (withSidebar
            // per row, same as "distinct"/"overlap"), so the compare row's
            // badges slide up WITH its graph as one rigid unit — explicit
            // feedback: "graphs slide towards graphs, badges towards
            // badges," which is exactly what moving matched graph+badges
            // rows together achieves (same horizontal lane throughout,
            // only vertical position changes).
            return (
              <>
                {withSidebar(currentChart)}
                {compareCard && <div className="hra-merge-up hra-section-gap-top">{withSidebar(compareCard, compareOtherKeyMetrics)}</div>}
              </>
            );
          case "d2o-fade":
            return (
              <div className="hra-crossfade">
                <div className="hra-crossfade-out">{withSidebar(mergedPair())}</div>
                <div className="hra-crossfade-in">{withSidebar(overlapChart)}</div>
              </div>
            );
          case "o2d-fade":
            return (
              <div className="hra-crossfade">
                <div className="hra-crossfade-out">{withSidebar(overlapChart)}</div>
                <div className="hra-crossfade-in">{withSidebar(mergedPair())}</div>
              </div>
            );
          case "o2d-slide":
            // Compare card starts translated up to visually overlap current
            // (matching o2d-fade's end state) and animates back down to its
            // own normal-flow slot — the exact structural mirror of
            // "d2o-move" (real layout box + withSidebar per row, animated
            // via transform only), not the old position:absolute overlay
            // version. That asymmetry was the actual bug: an absolutely
            // positioned compare card contributes nothing to its ancestor's
            // height, so its "Other key metrics" sidebar (a separate flex
            // column sized off that same ancestor) had no stable box to
            // stretch to during this one phase — explicit feedback:
            // "towards direction ok, away from direction badges disappear
            // and appear only at the end."
            return (
              <>
                {withSidebar(currentChart)}
                {compareCard && <div className="hra-unmerge-down hra-section-gap-top">{withSidebar(compareCard, compareOtherKeyMetrics)}</div>}
              </>
            );
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
interface TrendsProps {
  from: string; to: string; compareFrom: string; compareTo: string; compareEnabled: boolean;
  // Raw figures (OverviewTab's existing SportSummary-derived `run`/`prevRun`
  // — already the source of truth the old "Running" stat grid used) instead
  // of a pre-built KPI ReactNode: the main graph's KPI cards need `viewMode`
  // to decide whether to show a difference at all, so they're built HERE.
  run?: SportSummary;
  prevRun?: ReturnType<typeof prevSportStats> | null;
  // Lifted to OverviewTab (not owned locally) — "Other key metrics" below,
  // a sibling this component knows nothing about, needs the exact same
  // overlap/distinct state to decide whether IT shows a difference too
  // (explicit feedback: distinct never shows a delta, overlap always does).
  viewMode: TrendViewMode;
  setViewMode: (mode: TrendViewMode) => void;
  // "Other key metrics" panel, built by OverviewTab (it owns totals/
  // prevActs/etc.) — rendered as a vertical sidebar beside the main graph
  // (explicit feedback: "stack other key metrics vertically aside on the
  // right of the graph... shrink width of the graph, increase the height
  // so they're aligned in a rectangle"). Only shown beside the PRIMARY
  // graph; other sports (if any) render full-width below, unchanged.
  // `compareOtherKeyMetrics` is the SAME shape, computed from the compare
  // period's own activities instead — shown beside the compare card
  // specifically (explicit feedback: "data in the Other metric of the
  // second graph must be the data of the second graph").
  otherKeyMetrics?: ReactNode;
  compareOtherKeyMetrics?: ReactNode;
}

function TrendsBySport({ from, to, compareFrom, compareTo, compareEnabled, run, prevRun, viewMode, setViewMode, otherKeyMetrics, compareOtherKeyMetrics }: TrendsProps) {
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
  // "Overlapping" or "Distinct" (default, explicit feedback: differences are
  // an overlap-only concept — distinct mode shows each period's own numbers
  // side by side, with no computed delta) — one shared toggle for every
  // sport's chart on this tab, only shown while comparison is enabled
  // (nothing to overlap/separate otherwise). Lifted to OverviewTab (passed
  // in as props) rather than owned here, since "Other key metrics" below —
  // a sibling this component knows nothing about — needs the SAME
  // showDiff gate the main graph's own KPI cards use.
  const showDiff = compareEnabled && viewMode === "overlap";

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

  // "Other key metrics" is sitewide (from OverviewTab's own /api/v1/summary
  // query), independent of this component's own activities query — it must
  // still render through every one of this query's own states, not just
  // "success with data," or it would flicker/disappear on every load and
  // vanish entirely on a genuinely activity-less period.
  if (state.status === "loading") return <>{otherKeyMetrics}<LoadingSpinner label={t("overview.trendsLoading", "Loading trends…")} /></>;
  if (state.status === "error")   return <>{otherKeyMetrics}<ErrorBanner message={state.error} /></>;
  if (state.status !== "success" || state.data.length === 0) return <>{otherKeyMetrics}</>;

  const modeEnabled: Record<GroupMode, boolean> = { single: true, week: weekEnabled, month: monthEnabled };

  // One shared control cluster (Overlapping/Distinct + Single/Week/Month) —
  // unchanged mechanics, just relocated: it used to sit above the whole
  // sports list as a page-level section header; graph-first reorg moves it
  // into running's own card header (below), the page's one primary graph,
  // since that's the only chart these controls visually belong beside now.
  const modeControls = (
    <div className="hra-row gap-2">
      {compareEnabled && (
        <div className="hra-segment">
          {(["overlap", "distinct"] as const).map(v => (
            <button key={v}
              className="hra-segment-item" data-active={viewMode === v}
              onClick={() => setViewMode(v)}>
              {v === "overlap" ? t("overview.view.overlap", "Overlay") : t("overview.view.distinct", "Side by side")}
            </button>
          ))}
        </div>
      )}
      {/* One segmented container (polish pass) — a single joined bar housing
          all three modes, rather than three independently-bordered buttons,
          so the group reads as one control (dashboard design-system rework:
          .hra-segment, same shape every switch app-wide now uses). */}
      <div className="hra-segment">
        {GROUP_MODES.map(m => (
          <button key={m}
            className="hra-segment-item" data-active={groupMode === m}
            onClick={() => setGroupMode(m)}
            disabled={!modeEnabled[m]}
            title={modeEnabled[m] ? undefined : t("overview.groupDisabledTooltip", `Needs at least ${minGroupSize} ${m}s in the selected range`, { count: minGroupSize, mode: m })}>
            {t(`overview.group.${m}`, GROUP_LABEL[m])}
          </button>
        ))}
      </div>
    </div>
  );

  // Running is the page's one graph-first star (per the reorg spec/mockup);
  // every other sport (if any) keeps rendering exactly as before, further
  // down, under its own plain section title — no size/header change, no
  // duplicated mode controls (they stay shared state, just shown once).
  const runningEntry = sportsSorted.find(([sport]) => sport === "running");
  const otherEntries = sportsSorted.filter(([sport]) => sport !== "running");

  const runningKpis = run && prevRun ? (
    <>
      <GraphKpiCard icon={<Gauge size={16} />} iconColor="var(--accent)"
        value={fmtPace(run.avg_pace ?? 0)} unit={paceUnitLabel()}
        label={t("overview.stat.avgPace", "Avg pace")}
        deltaText={showDiff ? comparisonTooltip(run.avg_pace ?? 0, prevRun.avgPace, v => `${fmtPace(v)}/${distanceUnitLabel()}`, undefined, /* invert */ true) : undefined}
        deltaPositive={showDiff ? deltaPositive(run.avg_pace ?? 0, prevRun.avgPace, true) : undefined} />
      <GraphKpiCard icon={<MapPin size={16} />} iconColor="var(--accent)"
        value={splitUnit(fmtKm(run.total_km * 1000)).main} unit={splitUnit(fmtKm(run.total_km * 1000)).unit}
        label={t("overview.stat.distance", "Distance")}
        deltaText={showDiff ? comparisonTooltip(run.total_km, prevRun.km || null, v => fmtKm(v * 1000)) : undefined}
        deltaPositive={showDiff ? deltaPositive(run.total_km, prevRun.km || null) : undefined} />
      {/* 3rd position (dashboard design-system rework: "move Activities
          badge inside the graph") — moved out of the otherKeyMetrics
          sidebar below, which used to be the only place it showed. */}
      <GraphKpiCard icon={<RunnerGlyph pose="a" size={16} />} iconColor="var(--accent)"
        value={String(run.total_activities)}
        label={t("overview.stat.activities", "Activities")}
        deltaText={showDiff ? comparisonTooltip(run.total_activities, prevRun.sessions, v => String(v)) : undefined}
        deltaPositive={showDiff ? deltaPositive(run.total_activities, prevRun.sessions) : undefined} />
    </>
  ) : undefined;
  // The compare period's OWN totals — no delta (there's nothing further
  // back to compare a reference period against) — explicit feedback: "even
  // the second graph must have 'other metrics badges'."
  const compareKpis = prevRun ? (
    <>
      <GraphKpiCard icon={<Gauge size={16} />} iconColor="var(--accent)"
        value={prevRun.avgPace ? fmtPace(prevRun.avgPace) : "—"} unit={paceUnitLabel()}
        label={t("overview.stat.avgPace", "Avg pace")} />
      <GraphKpiCard icon={<MapPin size={16} />} iconColor="var(--accent)"
        value={splitUnit(fmtKm(prevRun.km * 1000)).main} unit={splitUnit(fmtKm(prevRun.km * 1000)).unit}
        label={t("overview.stat.distance", "Distance")} />
      <GraphKpiCard icon={<RunnerGlyph pose="a" size={16} />} iconColor="var(--accent)"
        value={String(prevRun.sessions)}
        label={t("overview.stat.activities", "Activities")} />
    </>
  ) : undefined;

  return (
    <>
      {runningEntry ? (
        // No outer section title/icon here (exact-layout spec: "do not put
        // any other... section titles... between the KPI/legend row and the
        // graph") — the icon+title now lives INSIDE the graph card's own
        // header (SportTrendPair's `primary` render). "Other key metrics"
        // is placed BESIDE each graph from inside SportTrendPair itself now
        // (its `withSidebar` helper), not wrapped once around the whole
        // pair here — explicit feedback: it must sit next to the second
        // (comparison) graph too, not just the first.
        <SportTrendPair sport={runningEntry[0]} activities={runningEntry[1]}
          compareActivities={compareBySport.get(runningEntry[0]) ?? []}
          mode={groupMode} minGroupSize={minGroupSize} compareEnabled={compareEnabled}
          from={from} to={to} compareFrom={compareFrom} compareTo={compareTo} viewMode={viewMode}
          primary headerControls={modeControls} kpis={runningKpis} compareKpis={compareKpis}
          otherKeyMetrics={otherKeyMetrics} compareOtherKeyMetrics={compareOtherKeyMetrics} />
      ) : (
        // No running trend chart to sit beside (no running activities this
        // period, or activities still loading) — "Other key metrics" shows
        // sitewide totals independent of any one sport's chart, so it still
        // renders on its own rather than disappearing with the graph.
        otherKeyMetrics
      )}
      {/* Week/month enable/disable above is still driven by the CURRENT
          period's data only — the comparison window has no vote over which
          modes are offered, only over what its own chart shows once a mode
          is picked (per-side "too few" gating is SportTrendPair's job now,
          not this map). */}
      {otherEntries.length > 0 && (
        <>
          {!runningEntry && (
            <div className="flex items-center justify-between mt-6 mb-1 flex-wrap gap-2">
              <SectionTitle>{t("overview.trendSectionTitle", "Distance & pace/HR trend")}</SectionTitle>
              {modeControls}
            </div>
          )}
          {otherEntries.map(([sport, acts]) => (
            <SportTrendPair key={sport} sport={sport} activities={acts}
              compareActivities={compareBySport.get(sport) ?? []}
              mode={groupMode} minGroupSize={minGroupSize} compareEnabled={compareEnabled}
              from={from} to={to} compareFrom={compareFrom} compareTo={compareTo} viewMode={viewMode} />
          ))}
        </>
      )}
    </>
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

// The ONE canonical difference format used everywhere on this tab (rule,
// docs/frontend.md's "Metric card / difference convention"): the previous
// value, then the signed percentage in brackets — e.g. "40.02 km (-7%)".
// No connecting word ("vs", "vs previous period:", etc.) — explicit
// feedback, twice now: "just show up or down arrow, value, percentage,"
// nothing else. The arrow itself is rendered separately by Stat/
// GraphKpiCard (see deltaPositive below), not part of this string.
// `prefix` defaults to none — the By-sport rows are the one place that
// still passes an explicit prefix ("sessions: "/"HR: "/"pace: "), since
// there each figure sits inline in one combined sentence, not its own
// badge. `invert`: for a measure where LOWER is better (pace), the raw
// current-vs-previous percentage is negative when the metric actually
// improved — negating it here is what makes "+3%" read as "3% faster,"
// matching the up-arrow/green color instead of contradicting it.
function comparisonTooltip(current: number, previous: number | null, fmt: (v: number) => string, prefix?: string, invert = false): string | undefined {
  const pct = pctChange(current, previous);
  if (pct == null) return undefined;
  const displayed = invert ? -pct : pct;
  const p = prefix ?? "";
  return `${p}${fmt(previous!)} (${displayed >= 0 ? "+" : ""}${displayed.toFixed(0)}%)`;
}

// The arrow/color half of the same comparison — kept separate from the text
// above since Stat/GraphKpiCard render the arrow themselves (colored via
// deltaPositive), not as part of the string.
function deltaPositive(current: number, previous: number | null, invert = false): boolean | undefined {
  const pct = pctChange(current, previous);
  if (pct == null) return undefined;
  return (invert ? -pct : pct) >= 0;
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

export function OverviewTab({ range, compareRange, savedRanges }: Props) {
  const { t } = useTranslation();
  const { from, to } = range;
  // The "compare to" range — powers every "vs previous period" comparison on
  // this tab (hero rings, Total tooltips, By-sport tooltips, AND each sport's
  // second trend chart), plus the linked-race lookup below. One fetch,
  // reused for all of them. useCompareRange keeps this in sync with `range`
  // on its own (see that hook's defaultCompareRange) — no fallback needed.
  const compareFrom = compareRange.from;
  const compareTo = compareRange.to;

  // Owned here (not inside TrendsBySport) so "Other key metrics" below can
  // gate its own difference display on the same overlap/distinct state the
  // main graph's KPI cards use — see showDiff below.
  // Backed by the URL's `trendsView` param (HRA-195, reusing HRA-193's
  // useUrlState) so a refresh keeps the last-picked overlap/distinct mode.
  const [rawTrendsView, setRawTrendsView] = useUrlState("trendsView", "distinct");
  const viewMode: TrendViewMode = rawTrendsView === "overlap" ? "overlap" : "distinct";
  const setViewMode = (mode: TrendViewMode) => setRawTrendsView(mode);
  const showDiff = compareRange.enabled && viewMode === "overlap";

  const { state } = useQuery(() => api.garmin.summary(from, to), [from, to]);
  const rangeQ = useQuery(() => api.garmin.range(), []);
  // Skipped entirely while the "Compare" switch is off (DateRangeBar) — no
  // request, no comparison data anywhere on this tab (rings, tooltips, each
  // sport's second trend chart, the linked-race row all key off this).
  const prevActivitiesQ = useQuery(
    () => compareRange.enabled ? api.garmin.activities(compareFrom, compareTo) : Promise.resolve([]),
    [compareFrom, compareTo, compareRange.enabled],
  );
  // savedRanges (prop) feeds DateRangeBar's two named-range dropdowns AND
  // this tab's own "compare-to is a linked race" detection below.
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

  // Tightened from 20px (graph-first reorg, spec: "reduce unnecessary
  // vertical spacing around the filters so the main graph appears sooner").
  const dateRangeBar = (
    <div className="mb-2">
      <DateRangeBar {...range} compare={compareRange} savedRanges={savedRanges} />
    </div>
  );

  // DateRangeBar (+ its named-range rows) stays visible — and sticky, same
  // as the success case below — through loading/error/empty too, so the
  // range can still be changed out of any of those states.
  if (state.status === "loading") {
    return <><div className="hra-sticky-summary">{dateRangeBar}</div><LoadingSpinner label={t("overview.loading", "Loading overview…")} /></>;
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
  // Avg distance = total km / total sessions — its own "previous" value is
  // the SAME ratio computed over the previous period, not prevKm alone
  // (explicit feedback: "Even when compared, AVG Distance missed the
  // compared values" — it had no delta at all before).
  const prevAvgDistance = hasPrevData && prevActs ? (prevKm ?? 0) / prevActs : null;
  const prevBySport = new Map(groupActivitiesBySport(prevActivities));
  // Hoisted (was computed inline inside the old "Running" stat grid's IIFE)
  // so both the main graph's KPI mini-cards and "Other key metrics" below can
  // share this one prevSportStats() call instead of recomputing it twice.
  const prevRun = run ? prevSportStats(prevBySport.get(run.sport ?? "other") ?? []) : null;

  const linkedRaceRow: ReactNode = linkedRaceActivity ? (
    <ActivityRow
      activity={linkedRaceActivity}
      expanded={detailView === "accordion" && raceExpanded}
      expandIndicator={detailView}
      onClick={() => detailView === "accordion" ? setRaceExpanded(e => !e) : setRaceModalOpen(true)}
      onDelete={() => setRaceExpanded(false)}
      expandedContent={
        <ActivityDetailBody activityId={linkedRaceActivity.id} onDelete={() => setRaceExpanded(false)} />
      }
    />
  ) : null;

  // One consolidated column (was "Key metrics" + "Additional details", then
  // "Other key metrics") — Distance and Avg pace are dropped here since the
  // main graph's own KPI cards already show them; Elevation dropped per
  // explicit spec; Activities moved into the graph's own KPI row too
  // (dashboard design-system rework, 3rd position, see runningKpis/compareKpis
  // above). No section title (explicit feedback: "remove other key metrics
  // title") — it's visually obvious as the graph's sidebar. Always ONE
  // column, never a multi-column grid (explicit feedback: "correspondant
  // metrics must be stacked in one column only") — this sidebar can be wider
  // than StatGrid's own auto-fill breakpoint, so the column count is forced
  // here rather than left to that grid's responsive default. Icon coloring
  // rule (explicit feedback): heart matches the HR value's own color; flame
  // is a filled dark orange; every other icon (map-pin/timer) uses the plain
  // accent color. Differences only show while overlap mode is active
  // (showDiff) — explicit feedback: "do not show differences when they're
  // distinct." Passed to TrendsBySport, which renders it as a vertical
  // sidebar beside the main graph.
  const otherKeyMetrics = (
    <div className="grid grid-cols-1 gap-2.5">
      {totals.acts > 0 && (
        <Stat icon={<MapPin size={18} color="var(--accent)" />} label={t("overview.stat.avgDistance", "Avg distance")} value={fmtKm((totals.km / totals.acts) * 1000)}
          deltaText={showDiff ? comparisonTooltip(totals.km / totals.acts, prevAvgDistance, v => fmtKm(v * 1000)) : undefined}
          deltaPositive={showDiff ? deltaPositive(totals.km / totals.acts, prevAvgDistance) : undefined} />
      )}
      {run?.avg_hr && (
        <Stat icon={<Heart size={18} color="var(--accent-red)" />} label={t("overview.stat.avgHr", "Avg HR")} value={`${run.avg_hr} bpm`} accent="var(--accent-red)"
          deltaText={showDiff && prevRun ? comparisonTooltip(run.avg_hr, prevRun.avgHr, v => `${Math.round(v)} bpm`) : undefined}
          deltaPositive={showDiff && prevRun ? deltaPositive(run.avg_hr, prevRun.avgHr) : undefined} />
      )}
      <Stat icon={<Timer size={18} color="var(--accent)" />} label={t("overview.stat.time", "Time")} value={`${totals.hours.toFixed(1)} h`}
        deltaText={showDiff ? comparisonTooltip(totals.hours, prevHours, v => `${v.toFixed(1)} h`) : undefined}
        deltaPositive={showDiff ? deltaPositive(totals.hours, prevHours) : undefined} />
      {totals.calories > 0 && (
        <Stat icon={<Flame size={18} color="color-mix(in srgb, var(--accent-orange) 65%, black)" fill="color-mix(in srgb, var(--accent-orange) 65%, black)" />}
          label={t("overview.stat.calories", "Calories")} value={`${totals.calories.toLocaleString()} kcal`}
          deltaText={showDiff ? comparisonTooltip(totals.calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`) : undefined}
          deltaPositive={showDiff ? deltaPositive(totals.calories, prevCalories) : undefined} />
      )}
    </div>
  );

  // Same shape, but the COMPARE period's own totals — no delta (there's
  // nothing further back to compare a reference period against, same
  // reasoning as compareKpis) — explicit feedback: "data in the Other
  // metric of the second graph must be the data of the second graph."
  const compareOtherKeyMetrics = hasPrevData ? (
    <div className="grid grid-cols-1 gap-2.5">
      {prevActs ? (
        <Stat icon={<MapPin size={18} color="var(--accent)" />} label={t("overview.stat.avgDistance", "Avg distance")} value={fmtKm((prevAvgDistance ?? 0) * 1000)} />
      ) : null}
      {prevRun?.avgHr ? (
        <Stat icon={<Heart size={18} color="var(--accent-red)" />} label={t("overview.stat.avgHr", "Avg HR")} value={`${Math.round(prevRun.avgHr)} bpm`} accent="var(--accent-red)" />
      ) : null}
      <Stat icon={<Timer size={18} color="var(--accent)" />} label={t("overview.stat.time", "Time")} value={`${(prevHours ?? 0).toFixed(1)} h`} />
      {prevCalories ? (
        <Stat icon={<Flame size={18} color="color-mix(in srgb, var(--accent-orange) 65%, black)" fill="color-mix(in srgb, var(--accent-orange) 65%, black)" />}
          label={t("overview.stat.calories", "Calories")} value={`${Math.round(prevCalories).toLocaleString()} kcal`} />
      ) : null}
    </div>
  ) : undefined;

  return (
    <>
      {/* Filters only in the sticky header now — graph-first reorg. The
          hero-ring summary card (Activities/Distance/Time/Calories as
          concentric gauges) is retired in favor of the flat "Key metrics"
          row below, which shows the exact same four figures: keeping both
          would just duplicate them in two different visual languages. A
          linked race (if the compare-side named range points at one) still
          gets its own small card, right under the filters, same as before. */}
      <div className="hra-sticky-summary">
        {dateRangeBar}
      </div>
      {linkedRaceRow && <Card className="mb-5">{linkedRaceRow}</Card>}

      <TrendsBySport from={from} to={to} compareFrom={compareFrom} compareTo={compareTo} compareEnabled={compareRange.enabled}
        run={run} prevRun={prevRun} viewMode={viewMode} setViewMode={setViewMode}
        otherKeyMetrics={otherKeyMetrics} compareOtherKeyMetrics={compareOtherKeyMetrics} />

      {sports.length > 1 && (
        <>
          <SectionTitle>{t("overview.bySportSectionTitle", "By sport")}</SectionTitle>
          <div className="grid gap-2">
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
                  className="hra-sport-summary-card"
                >
                  <Badge label={s.sport ?? "other"} color={SPORT_COLOR[getResolvedTheme()][s.sport ?? "other"] ?? "#888"} />
                  <span className="hra-text-primary flex-1 font-medium">
                    {fmtKm(s.total_km * 1000)}
                  </span>
                  <span className="hra-text-secondary">{t("overview.bySportSessionsLabel", `${s.total_activities} sessions`, { count: s.total_activities })}</span>
                  {s.avg_hr && (
                    <span className="hra-text-danger text-label">♥ {s.avg_hr}</span>
                  )}
                  {s.avg_pace && (
                    <span className="hra-text-muted text-label">{fmtPace(s.avg_pace)}/{distanceUnitLabel()}</span>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

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
