import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, ReferenceLine, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { api } from "@/api/client";
import {
  Card, ChartCard, ChartPillLegend, chartGrid, chartTick,
  Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, Badge, RangeEmpty,
  splitUnit,
} from "@/components/ui";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { fmtPace, fmtKm, fmtElevation, fmtMinSecRaw } from "@/utils/fmt";
import { getUnitSystem, kmToMi, paceKmToMi, distanceUnitLabel, paceUnitLabel } from "@/utils/units";
import {
  type GroupMode, defaultGroupMode, isoWeekStart, buildTrendPoints, meanCenteredDomain, swimPacePer100m,
  groupActivitiesBySport,
} from "@/domain/trends";

interface Props { from: string; to: string; }

// ── Distance/pace/HR trend, one chart per sport ─────────────────────────────
// Bars are total distance per group (one activity per bar in "single" mode,
// summed across the group in "week"/"month" mode); the pace and HR lines
// connect one point per bar, at that bar's x position — Recharts' default
// categorical-axis behavior already centers Bar and Line data at the same x
// tick, so no manual positioning is needed for "starts from the horizontal
// center of the bar."
const GROUP_MODES: GroupMode[] = ["single", "week", "month"];
const GROUP_LABEL: Record<GroupMode, string> = { single: "Single", week: "Week", month: "Month" };


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
// in SportTrendChart — no CSS-class equivalent for SVG gradient stops).
const BAR_RADIUS: [number, number, number, number] = [6, 6, 0, 0];


function SportTrendChart({ sport, activities, mode }: { sport: string; activities: Activity[]; mode: GroupMode }) {
  const points = buildTrendPoints(activities, mode);
  // Legend as clickable pill chips (polish pass) — each series can be hidden
  // independently, same toggle-a-Set pattern BodyTab's metric pills already
  // use. Reference lines for a hidden pace/HR line hide with it, so a
  // toggled-off series never leaves orphaned dashed lines on screen.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggleSeries = (key: string) => setHidden(h => {
    const next = new Set(h);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Swimming pace is conventionally per 100m, not per km — avg_pace_minkm
  // (minutes per km) × 0.1 = minutes per 100m, a plain unit conversion, no
  // different source data. Scoped to the Overview tab only, per request —
  // ActivityModal and other tabs still show swimming pace as /km. Kept as
  // literally "per 100m" regardless of unit system (not per-100-yards) —
  // a deliberate scoping choice, not full imperial swim-pace support.
  const isSwimming = sport === "swimming";
  const imperial = getUnitSystem() === "imperial";
  const paceUnit = isSwimming ? "/100m" : (imperial ? "/mi" : "/km");
  const distanceUnit = distanceUnitLabel();
  // Scales a raw min/km average into whatever unit this chart displays.
  // Values are pre-scaled here (not left in min/km and converted only at
  // format time) because the SAME number drives the chart's Y position
  // (via paceDomain/the Line/the ReferenceLine) as well as the displayed
  // text — if only the text conversion happened, the line would still plot
  // at the min/km value while the label claimed min/mi, silently
  // mismatched. fmtMinSecRaw (below) only formats, it never re-converts.
  const scalePace = (minPerKm: number) => (isSwimming ? swimPacePer100m(minPerKm) : imperial ? paceKmToMi(minPerKm) : minPerKm);
  const displayPoints = points.map(p => ({
    ...p,
    avgPace: p.avgPace != null ? scalePace(p.avgPace) : null,
    totalKm: imperial ? kmToMi(p.totalKm) : p.totalKm,
  }));

  // The min/max reference lines mark the highest/lowest GROUP AVERAGE (the
  // actual bars/points plotted) — not the single most extreme individual
  // activity, which can be an outlier unrelated to the visualized bars and
  // isn't a meaningful comparison against them. In "single" mode a "group"
  // is one activity, so these end up identical to the individual extremes;
  // in "week"/"month" mode, averaging narrows the band, which is the point.
  const groupPaces = displayPoints.map(p => p.avgPace).filter((v): v is number => v != null);
  const groupHrs = displayPoints.map(p => p.avgHr).filter((v): v is number => v != null);
  const refMinPace = groupPaces.length ? Math.min(...groupPaces) : null;
  const refMaxPace = groupPaces.length ? Math.max(...groupPaces) : null;
  const refMinHr = groupHrs.length ? Math.min(...groupHrs) : null;
  const refMaxHr = groupHrs.length ? Math.max(...groupHrs) : null;

  // Per-activity (not per-group) extremes — used only to size the axis's own
  // domain (per explicit request, the axis can still stretch to the true
  // individual extremes even though the reference lines above mark the
  // narrower group-average band). Also drives the overall avg line, which
  // stays a straight average across every individual activity — a weighted
  // average of the group averages is mathematically always within
  // [refMinPace, refMaxPace], so it can never end up outside that band.
  const allPaces = activities.map(a => a.avg_pace_minkm).filter((v): v is number => v != null).map(scalePace);
  const allHrs = activities.map(a => a.avg_hr).filter((v): v is number => v != null);
  const overallAvgPace = allPaces.length ? allPaces.reduce((s, v) => s + v, 0) / allPaces.length : null;
  const absoluteMinPace = allPaces.length ? Math.min(...allPaces) : null;
  const absoluteMaxPace = allPaces.length ? Math.max(...allPaces) : null;
  const overallAvgHr = allHrs.length ? allHrs.reduce((s, v) => s + v, 0) / allHrs.length : null;
  const absoluteMinHr = allHrs.length ? Math.min(...allHrs) : null;
  const absoluteMaxHr = allHrs.length ? Math.max(...allHrs) : null;

  // Domain widened (never narrowed) to fit the absolute individual extremes.
  // Floor clamped to 0 — pace can't physically be negative (belt-and-
  // suspenders alongside the reversed axis below, same as ActivityModal's).
  const paceDomainBase = meanCenteredDomain(displayPoints.map(p => p.avgPace).filter((v): v is number => v != null));
  const paceDomain: [number, number] = [
    Math.max(0, absoluteMinPace != null ? Math.min(paceDomainBase[0], absoluteMinPace) : paceDomainBase[0]),
    absoluteMaxPace != null ? Math.max(paceDomainBase[1], absoluteMaxPace) : paceDomainBase[1],
  ];
  const hrDomainBase = meanCenteredDomain(displayPoints.map(p => p.avgHr).filter((v): v is number => v != null));
  const hrDomain: [number, number] = [
    absoluteMinHr != null ? Math.min(hrDomainBase[0], absoluteMinHr) : hrDomainBase[0],
    absoluteMaxHr != null ? Math.max(hrDomainBase[1], absoluteMaxHr) : hrDomainBase[1],
  ];

  const badgeColor = SPORT_COLOR[sport] ?? "#888";
  const hrColor = "var(--data-hr)"; // fixed semantic data color (HRA-94/97) — was --accent-red, same hex today

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Badge label={sport} color={badgeColor} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {points.length} {mode === "single" ? "activities" : mode === "week" ? "weeks" : "months"}
          {overallAvgPace != null && <> · avg {fmtMinSecRaw(overallAvgPace)}{paceUnit} ({fmtMinSecRaw(refMinPace!)}–{fmtMinSecRaw(refMaxPace!)})</>}
          {overallAvgHr != null && <> · avg {Math.round(overallAvgHr)} bpm ({Math.round(refMinHr!)}–{Math.round(refMaxHr!)})</>}
        </span>
      </div>
      <ChartCard legend={
        <div style={{ marginLeft: "auto" }}>
          <ChartPillLegend
            items={[
              { key: "totalKm", label: "Distance", color: "color-mix(in srgb, var(--data-pace) 28%, transparent)", active: !hidden.has("totalKm") },
              { key: "avgPace", label: "Avg pace", color: PACE_LINE_COLOR, active: !hidden.has("avgPace") },
              { key: "avgHr", label: "Avg HR", color: hrColor, active: !hidden.has("avgHr") },
            ]}
            onToggle={toggleSeries}
          />
        </div>
      }>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={displayPoints}>
          <defs>
            <linearGradient id={`barGrad-${sport}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--data-pace)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--data-pace)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridStyle} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} />
          {/* Three separate tick-label columns — km and pace stacked on the
              left (Recharts stacks multiple visible same-side axes
              automatically), HR alone on the right — each tinted to match
              its own line/bar color so the column and its series are
              visually tied together. Pace/HR used to be `hide`, showing no
              numbers at all; the reference lines had nothing to visually
              anchor against, which read as "wrongly placed" even when the
              underlying values were correct. Pace is reversed — lower
              (faster) reads toward the top, this chart always shows pace
              (never speed), so unlike ActivityModal this doesn't need to be
              conditional. */}
          <YAxis yAxisId="km" tick={{ fill: BAR_COLOR, fontSize: 9 }} tickLine={false} axisLine={false} width={32}
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
              // One combined line ("07-24 · 6.5 km · pace 5:12 · HR 158"),
              // each value colored to match its series, instead of the
              // three separately-swatched rows Recharts' default Tooltip
              // renders — a single glance covers the whole hovered point.
              // Colors are CSS classes (.hra-chart-tooltip-*, index.css),
              // not inline style — km reads neutral now that bars are a
              // muted volume wash rather than a foreground series.
              return (
                <div className="hra-chart-tooltip">
                  <span className="hra-chart-tooltip-label">{label}</span>
                  {typeof kmVal === "number" && (
                    <><span className="hra-chart-tooltip-sep">·</span><span className="hra-chart-tooltip-km">{kmVal.toFixed(1)} {distanceUnit}</span></>
                  )}
                  {typeof paceVal === "number" && (
                    <><span className="hra-chart-tooltip-sep">·</span><span className="hra-chart-tooltip-pace">pace {fmtMinSecRaw(paceVal)}{paceUnit}</span></>
                  )}
                  {typeof hrVal === "number" && (
                    <><span className="hra-chart-tooltip-sep">·</span><span className="hra-chart-tooltip-hr">HR {Math.round(hrVal)}</span></>
                  )}
                </div>
              );
            }}
          />
          {!hidden.has("totalKm") && (
            <Bar yAxisId="km" dataKey="totalKm" name="Distance" fill={`url(#barGrad-${sport})`} radius={BAR_RADIUS}
              activeBar={{ fill: "var(--data-pace)", fillOpacity: 0.4 }} isAnimationActive={false} />
          )}
          {!hidden.has("avgPace") && (
            <Line yAxisId="pace" dataKey="avgPace" name="Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2.5}
              className="hra-trend-line-pace"
              dot={{ r: 2.5, fill: PACE_LINE_COLOR, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: PACE_LINE_COLOR, stroke: "var(--bg-card)", strokeWidth: 2 }}
              connectNulls isAnimationActive={false} />
          )}
          {!hidden.has("avgHr") && (
            <Line yAxisId="hr" dataKey="avgHr" name="Avg HR" stroke={hrColor} strokeWidth={2.5}
              className="hra-trend-line-hr"
              dot={{ r: 2.5, fill: hrColor, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: hrColor, stroke: "var(--bg-card)", strokeWidth: 2 }}
              connectNulls isAnimationActive={false} />
          )}
          {/* Avg line reads strongest (higher opacity); min/max are fainter
              dashed lines on the same axis so the three together read as
              "the band this sport's pace/HR moved within," not three equally
              loud lines competing with the bars/lines above. Hidden along
              with their series when its legend chip is toggled off. */}
          {!hidden.has("avgPace") && overallAvgPace != null && <ReferenceLine yAxisId="pace" y={overallAvgPace} stroke={PACE_LINE_COLOR} strokeDasharray="4 4" strokeOpacity={0.7} />}
          {!hidden.has("avgPace") && refMinPace != null && <ReferenceLine yAxisId="pace" y={refMinPace} stroke={PACE_LINE_COLOR} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {!hidden.has("avgPace") && refMaxPace != null && <ReferenceLine yAxisId="pace" y={refMaxPace} stroke={PACE_LINE_COLOR} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {!hidden.has("avgHr") && overallAvgHr != null && <ReferenceLine yAxisId="hr" y={overallAvgHr} stroke={hrColor} strokeDasharray="4 4" strokeOpacity={0.7} />}
          {!hidden.has("avgHr") && refMinHr != null && <ReferenceLine yAxisId="hr" y={refMinHr} stroke={hrColor} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {!hidden.has("avgHr") && refMaxHr != null && <ReferenceLine yAxisId="hr" y={refMaxHr} stroke={hrColor} strokeDasharray="2 3" strokeOpacity={0.45} />}
        </ComposedChart>
      </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// A grouping is only offered if it actually produces something worth
// grouping — fewer groups than the configured threshold (Settings tab,
// default 5) isn't a meaningful trend, it's just a couple of bars. The same
// threshold also gates whether a sport's chart is shown at all in "single"
// mode (see sportsSorted.map below) — one number, two uses.
const DEFAULT_MIN_TREND_GROUP_SIZE = 5;

function TrendsBySport({ from, to }: Props) {
  const { state } = useQuery(() => api.garmin.activities(from, to), [from, to]);
  const { settings } = useSettings();
  const minGroupSize = settings?.min_trend_group_size ?? DEFAULT_MIN_TREND_GROUP_SIZE;
  const [groupMode, setGroupMode] = useState<GroupMode>(() => defaultGroupMode(from, to));
  useEffect(() => setGroupMode(defaultGroupMode(from, to)), [from, to]);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 4 }}>
        <SectionTitle>Distance & pace/HR trend</SectionTitle>
        {/* One segmented container (polish pass) — a single bordered pill
            housing all three modes, rather than three independently-bordered
            buttons, so the group reads as one control. Inactive items are
            identical (no per-item border/background), only the active one
            gets the gradient pill; hover is the shared quiet bg-tint. */}
        <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 999, border: "1px solid var(--border)" }}>
          {GROUP_MODES.map(m => (
            <button key={m}
              className={`hra-pill hra-nav-pill hra-nav-hover ${groupMode === m ? "hra-pill-active" : ""}`}
              onClick={() => setGroupMode(m)}
              disabled={!modeEnabled[m]}
              title={modeEnabled[m] ? undefined : `Needs at least ${minGroupSize} ${m}s in the selected range`}
              style={{
                fontSize: 11, padding: "3px 10px",
                cursor: modeEnabled[m] ? "pointer" : "not-allowed",
                opacity: modeEnabled[m] ? 1 : 0.4,
              }}>
              {GROUP_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
        Dashed horizontal lines: the bolder one is the overall avg pace/HR, the two fainter ones mark the highest/lowest pace/HR among the bars/points shown.
      </div>
      {sportsSorted.map(([sport, acts]) => {
        // In "single" mode each activity is its own bar, so the group-count
        // gate above doesn't apply — instead, gate directly on how many
        // activities of this sport exist at all. Week/month modes are
        // already gated by weekEnabled/monthEnabled (disabling the mode
        // entirely, not per-sport), so this only fires for "single".
        if (groupMode === "single" && acts.length < minGroupSize) {
          return (
            <div key={sport} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <Badge label={sport} color={SPORT_COLOR[sport] ?? "#888"} />
              </div>
              <Empty message={`Too few ${sport} activities to determine a trend (${acts.length} of ${minGroupSize} needed).`} />
            </div>
          );
        }
        return <SportTrendChart key={sport} sport={sport} activities={acts} mode={groupMode} />;
      })}
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
  id, current, previous, centerValue, unitLabel, comparisonText, tooltip,
  size = 179, stroke = 12, gap = 7,
}: {
  id: string; current: number; previous: number | null;
  centerValue: string; unitLabel: string; comparisonText?: string | null; tooltip?: string;
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
    // .hra-tooltip (index.css) — a styled hover tooltip on the whole ring,
    // not just its text; the value/comparison text also brighten on this
    // same hover (see .hra-tooltip:hover .hra-ring-* in index.css).
    <div className="hra-tooltip" data-tooltip={tooltip} style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
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

// "(previous value, ±N%)" for a ring's small comparison line.
function ringComparison(current: number, previous: number | null, fmt: (v: number) => string): string | null {
  const pct = pctChange(current, previous);
  if (pct == null) return null;
  return `(${fmt(previous!)}, ${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

// Same comparison, as a full sentence for a native `title` tooltip (Total
// StatGrid, By-sport rows) rather than a ring's compact bracketed line.
function comparisonTooltip(current: number, previous: number | null, fmt: (v: number) => string): string | undefined {
  const pct = pctChange(current, previous);
  if (pct == null) return undefined;
  return `vs previous period: ${fmt(previous!)} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

function PeriodHeroRing({
  activities, prevActivities, km, prevKm, hours, prevHours, calories, prevCalories, periodLabel,
}: {
  activities: number; prevActivities: number | null;
  km: number; prevKm: number | null;
  hours: number; prevHours: number | null;
  calories: number; prevCalories: number | null;
  periodLabel: string | null;
}) {
  const distance = splitUnit(fmtKm(km * 1000));
  return (
    <>
      {/* Title sits OUTSIDE the card, same as every other section's
          SectionTitle above its content (Total/Running/By sport) — this
          card used to carry its own header inside the tinted panel, which
          read as though the whole section had gone missing since nothing
          above the panel announced it. */}
      {/* Same element as the title (not a second line below it in a
          different, smaller font) — the period comparison reads as part of
          the section heading, not an annotation under it. */}
      <SectionTitle>Summary{periodLabel && ` — ${periodLabel}`}</SectionTitle>
      <Card className="hra-hero-tint" style={{ padding: "20px 24px", marginBottom: 20 }}>
        {/* justify-content: space-between — four rings spread evenly across
            the card's full width rather than clumping with a fixed gap. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 20 }}>
          <DualRingGauge id="acts" current={activities} previous={prevActivities} centerValue={String(activities)} unitLabel="ACTIVITIES"
            comparisonText={ringComparison(activities, prevActivities, v => String(v))}
            tooltip={comparisonTooltip(activities, prevActivities, v => String(v))} />
          <DualRingGauge id="dist" current={km} previous={prevKm} centerValue={distance.main} unitLabel={distance.unit ?? "KM"}
            comparisonText={ringComparison(km, prevKm, v => fmtKm(v * 1000))}
            tooltip={comparisonTooltip(km, prevKm, v => fmtKm(v * 1000))} />
          <DualRingGauge id="time" current={hours} previous={prevHours} centerValue={hours.toFixed(1)} unitLabel="HOURS"
            comparisonText={ringComparison(hours, prevHours, v => `${v.toFixed(1)} h`)}
            tooltip={comparisonTooltip(hours, prevHours, v => `${v.toFixed(1)} h`)} />
          <DualRingGauge id="cal" current={calories} previous={prevCalories} centerValue={String(Math.round(calories))} unitLabel="CALORIES"
            comparisonText={ringComparison(calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`)}
            tooltip={comparisonTooltip(calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`)} />
        </div>
      </Card>
    </>
  );
}

// Plain UTC-midnight date math on the app's own "YYYY-MM-DD" date strings —
// used only to derive the hero card's "previous window of equal length" for
// its delta chip (polish pass). UTC avoids any local-timezone day-boundary
// drift when shifting a date string that carries no time component.
function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
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

export function OverviewTab({ from, to }: Props) {
  const { state } = useQuery(() => api.garmin.summary(from, to), [from, to]);
  const rangeQ = useQuery(() => api.garmin.range(), []);
  // Previous window of equal length, immediately preceding `from` — powers
  // every "vs previous period" comparison on this tab (hero rings, Total
  // tooltips, By-sport tooltips). One fetch, reused for all of them.
  // windowDays is the plain from→to difference, with NO +1 — that would
  // count one extra day (e.g. the "30d" preset sets from = today−30,
  // to = today, a 30-day difference; +1 turned that into a 31-day
  // comparison window, one longer than the period it was meant to match).
  const windowDays = daysBetween(from, to);
  const prevTo = shiftIsoDate(from, -1);
  const prevFrom = shiftIsoDate(prevTo, -(windowDays - 1));
  const prevActivitiesQ = useQuery(() => api.garmin.activities(prevFrom, prevTo), [prevFrom, prevTo]);

  if (state.status === "loading") return <LoadingSpinner />;
  if (state.status === "error")   return <ErrorBanner message={state.error} />;
  if (state.status !== "success") return null;

  const sports = state.data;
  if (sports.length === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel="activities" />;
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
  const periodLabel = hasPrevData ? `vs previous ${windowDays}-day period (${prevFrom} – ${prevTo})` : null;
  const prevBySport = new Map(groupActivitiesBySport(prevActivities));

  return (
    <>
      <PeriodHeroRing
        activities={totals.acts} prevActivities={prevActs}
        km={totals.km} prevKm={prevKm}
        hours={totals.hours} prevHours={prevHours}
        calories={totals.calories} prevCalories={prevCalories}
        periodLabel={periodLabel}
      />

      <SectionTitle>Total</SectionTitle>
      <StatGrid>
        <Stat label="Activities" value={totals.acts} tooltip={comparisonTooltip(totals.acts, prevActs, v => String(v))} />
        <Stat label="Distance"   value={fmtKm(totals.km * 1000)} accent="var(--accent-green)"
          tooltip={comparisonTooltip(totals.km, prevKm, v => fmtKm(v * 1000))} />
        <Stat label="Time"       value={`${totals.hours.toFixed(1)} h`}
          tooltip={comparisonTooltip(totals.hours, prevHours, v => `${v.toFixed(1)} h`)} />
        {totals.calories > 0 && (
          <Stat label="Calories" value={`${totals.calories.toLocaleString()} kcal`}
            tooltip={comparisonTooltip(totals.calories, prevCalories, v => `${Math.round(v).toLocaleString()} kcal`)} />
        )}
        {totals.ascent > 0 && (
          <Stat label="Elevation gain" value={fmtElevation(totals.ascent)}
            tooltip={comparisonTooltip(totals.ascent, prevAscent, v => fmtElevation(v))} />
        )}
      </StatGrid>

      {run && (() => {
        const prevRun = prevSportStats(prevBySport.get(run.sport ?? "other") ?? []);
        return (
          <>
            <SectionTitle>Running</SectionTitle>
            <StatGrid>
              <Stat label="Sessions" value={run.total_activities}
                tooltip={comparisonTooltip(run.total_activities, prevRun.sessions || null, v => String(v))} />
              <Stat label="Distance" value={fmtKm(run.total_km * 1000)} accent="var(--accent-green)"
                tooltip={comparisonTooltip(run.total_km, prevRun.km || null, v => fmtKm(v * 1000))} />
              {run.avg_hr && (
                <Stat label="Avg HR" value={`${run.avg_hr} bpm`} accent="var(--accent-red)"
                  tooltip={comparisonTooltip(run.avg_hr, prevRun.avgHr, v => `${Math.round(v)} bpm`)} />
              )}
              {run.avg_pace && (
                <Stat label="Avg pace" value={fmtPace(run.avg_pace)} sub={paceUnitLabel()}
                  tooltip={comparisonTooltip(run.avg_pace, prevRun.avgPace, v => `${fmtPace(v)}/${distanceUnitLabel()}`)} />
              )}
              {run.total_ascent && (
                <Stat label="Elevation" value={fmtElevation(run.total_ascent)}
                  tooltip={comparisonTooltip(run.total_ascent, prevRun.ascent, v => fmtElevation(v))} />
              )}
            </StatGrid>
          </>
        );
      })()}

      {sports.length > 1 && (
        <>
          <SectionTitle>By sport</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {sports.map(s => {
              const prevSport = prevSportStats(prevBySport.get(s.sport ?? "other") ?? []);
              // One combined tooltip covering every comparable figure on the
              // row, not a separate title per span — a sport row has no room
              // for four individual tooltip targets the way the Total
              // StatGrid's cards do.
              const tooltip = [
                comparisonTooltip(s.total_km, prevSport.km || null, v => fmtKm(v * 1000)),
                comparisonTooltip(s.total_activities, prevSport.sessions || null, v => String(v))?.replace("vs previous period: ", "sessions: "),
                s.avg_hr != null ? comparisonTooltip(s.avg_hr, prevSport.avgHr, v => `${Math.round(v)} bpm`)?.replace("vs previous period: ", "HR: ") : undefined,
                s.avg_pace != null ? comparisonTooltip(s.avg_pace, prevSport.avgPace, v => `${fmtPace(v)}/${distanceUnitLabel()}`)?.replace("vs previous period: ", "pace: ") : undefined,
              ].filter(Boolean).join(" · ") || undefined;
              return (
                <Card
                  key={s.sport}
                  tooltip={tooltip}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", fontSize: 14 }}
                >
                  <Badge label={s.sport ?? "other"} color={SPORT_COLOR[s.sport ?? "other"] ?? "#888"} />
                  <span style={{ flex: 1, color: "var(--text-primary)", fontWeight: 500 }}>
                    {fmtKm(s.total_km * 1000)}
                  </span>
                  <span style={{ color: "var(--text-secondary)" }}>{s.total_activities} sessions</span>
                  {s.avg_hr && (
                    <span style={{ color: "var(--accent-red)", fontSize: 13 }}>♥ {s.avg_hr}</span>
                  )}
                  {s.avg_pace && (
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{fmtPace(s.avg_pace)}/{distanceUnitLabel()}</span>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <TrendsBySport from={from} to={to} />
    </>
  );
}
