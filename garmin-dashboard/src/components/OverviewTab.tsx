import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, ReferenceLine, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { api } from "@/api/client";
import { Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, Badge, RangeEmpty } from "@/components/ui";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { fmtPace, fmtKm, fmtElevation, fmtMinSecRaw } from "@/utils/fmt";
import { getUnitSystem, kmToMi, paceKmToMi, distanceUnitLabel, paceUnitLabel } from "@/utils/units";
import {
  type GroupMode, defaultGroupMode, isoWeekStart, buildTrendPoints, meanCenteredDomain, swimPacePer100m,
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


const axisStyle = { fill: "var(--text-muted)", fontSize: 10 };
const gridStyle = { stroke: "var(--border)", strokeDasharray: "3 3" };

// Pace's color intentionally matches ActivityModal.tsx's METRIC_DEFS.speed.color
// exactly — the activity detail view is this app's color "reference" for
// speed/pace, so this chart reuses it instead of a generic accent, for one
// consistent color across the whole app. HR already matched (--accent-red
// there and here), so it's untouched. Bars are a neutral gray, not a
// per-sport color — SPORT_COLOR can collide with the pace/HR line colors
// (cycling's SPORT_COLOR was literally identical to this chart's old pace
// blue, and running's green measured ~1.3:1 mutual contrast against it,
// effectively invisible where a line crossed a bar) — a neutral fill has no
// such collision regardless of sport or line color. Sport identity still
// shows via the Badge above the chart, which keeps SPORT_COLOR.
const PACE_LINE_COLOR = "#15965f";
const BAR_COLOR = "var(--text-secondary)";


function SportTrendChart({ sport, activities, mode }: { sport: string; activities: Activity[]; mode: GroupMode }) {
  const points = buildTrendPoints(activities, mode);

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
  const hrColor = "var(--accent-red)"; // already matches ActivityModal's heart_rate color — no change needed

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
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={displayPoints}>
          <CartesianGrid vertical={false} {...gridStyle} />
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
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
            formatter={(value, name) => {
              if (typeof value !== "number") return [String(value ?? ""), name];
              if (name === "Distance") return [`${value.toFixed(1)} ${distanceUnit}`, name];
              if (name === "Avg pace") return [`${fmtMinSecRaw(value)} ${paceUnit}`, name];
              if (name === "Avg HR") return [`${Math.round(value)} bpm`, name];
              return [value, name];
            }}
          />
          {/* Legend instead of per-line text labels — the earlier version
              put "avg"/"min"/"max" tags directly on the reference lines,
              which cluttered a 220px-tall chart. Legend covers what each
              color is (Distance/Avg pace/Avg HR); the dashed-vs-solid
              avg-vs-min/max convention is explained once in the section
              caption above every sport's chart instead of repeated per-line. */}
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="km" dataKey="totalKm" name="Distance" fill={BAR_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line yAxisId="pace" dataKey="avgPace" name="Avg pace" stroke={PACE_LINE_COLOR} strokeWidth={2}
            dot={false} connectNulls isAnimationActive={false} />
          <Line yAxisId="hr" dataKey="avgHr" name="Avg HR" stroke={hrColor} strokeWidth={2}
            dot={false} connectNulls isAnimationActive={false} />
          {/* Avg line reads strongest (higher opacity); min/max are fainter
              dashed lines on the same axis so the three together read as
              "the band this sport's pace/HR moved within," not three equally
              loud lines competing with the bars/lines above. */}
          {overallAvgPace != null && <ReferenceLine yAxisId="pace" y={overallAvgPace} stroke={PACE_LINE_COLOR} strokeDasharray="4 4" strokeOpacity={0.7} />}
          {refMinPace != null && <ReferenceLine yAxisId="pace" y={refMinPace} stroke={PACE_LINE_COLOR} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {refMaxPace != null && <ReferenceLine yAxisId="pace" y={refMaxPace} stroke={PACE_LINE_COLOR} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {overallAvgHr != null && <ReferenceLine yAxisId="hr" y={overallAvgHr} stroke={hrColor} strokeDasharray="4 4" strokeOpacity={0.7} />}
          {refMinHr != null && <ReferenceLine yAxisId="hr" y={refMinHr} stroke={hrColor} strokeDasharray="2 3" strokeOpacity={0.45} />}
          {refMaxHr != null && <ReferenceLine yAxisId="hr" y={refMaxHr} stroke={hrColor} strokeDasharray="2 3" strokeOpacity={0.45} />}
        </ComposedChart>
      </ResponsiveContainer>
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

  const activities = state.status === "success" ? state.data : [];
  const weekEnabled = new Set(activities.map(a => isoWeekStart(a.date_only))).size >= minGroupSize;
  const monthEnabled = new Set(activities.map(a => a.date_only.slice(0, 7))).size >= minGroupSize;

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

  const bySport = new Map<string, Activity[]>();
  for (const a of state.data) {
    const sport = a.sport ?? "other";
    (bySport.get(sport) ?? bySport.set(sport, []).get(sport)!).push(a);
  }
  const sportsSorted = [...bySport.entries()].sort((a, b) =>
    b[1].reduce((s, x) => s + (x.distance_m ?? 0), 0) - a[1].reduce((s, x) => s + (x.distance_m ?? 0), 0));

  const modeEnabled: Record<GroupMode, boolean> = { single: true, week: weekEnabled, month: monthEnabled };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 4 }}>
        <SectionTitle>Distance & pace/HR trend</SectionTitle>
        <div style={{ display: "flex", gap: 4 }}>
          {GROUP_MODES.map(m => (
            <button key={m} onClick={() => setGroupMode(m)}
              disabled={!modeEnabled[m]}
              title={modeEnabled[m] ? undefined : `Needs at least ${minGroupSize} ${m}s in the selected range`}
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999,
                cursor: modeEnabled[m] ? "pointer" : "not-allowed",
                opacity: modeEnabled[m] ? 1 : 0.4,
                border: `1px solid ${groupMode === m ? "var(--border-strong)" : "transparent"}`,
                background: groupMode === m ? "var(--bg-card)" : "transparent",
                color: groupMode === m ? "var(--text-primary)" : "var(--text-muted)",
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

export function OverviewTab({ from, to }: Props) {
  const { state } = useQuery(() => api.garmin.summary(from, to), [from, to]);
  const rangeQ = useQuery(() => api.garmin.range(), []);

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

  return (
    <>
      <SectionTitle>Total</SectionTitle>
      <StatGrid>
        <Stat label="Activities"    value={totals.acts} />
        <Stat label="Distance"      value={fmtKm(totals.km * 1000)}  accent="var(--accent-green)" />
        <Stat label="Time"          value={`${totals.hours.toFixed(1)} h`} />
        {totals.calories > 0 && <Stat label="Calories" value={`${totals.calories.toLocaleString()} kcal`} />}
        {totals.ascent   > 0 && <Stat label="Elevation gain" value={fmtElevation(totals.ascent)} />}
      </StatGrid>

      {run && (
        <>
          <SectionTitle>Running</SectionTitle>
          <StatGrid>
            <Stat label="Sessions"    value={run.total_activities} />
            <Stat label="Distance"    value={fmtKm(run.total_km * 1000)} accent="var(--accent-green)" />
            {run.avg_hr   && <Stat label="Avg HR"   value={`${run.avg_hr} bpm`}     accent="var(--accent-red)" />}
            {run.avg_pace && <Stat label="Avg pace" value={fmtPace(run.avg_pace)}    sub={paceUnitLabel()} />}
            {run.total_ascent && <Stat label="Elevation" value={fmtElevation(run.total_ascent)} />}
          </StatGrid>
        </>
      )}

      {sports.length > 1 && (
        <>
          <SectionTitle>By sport</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {sports.map(s => (
              <div
                key={s.sport}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          14,
                  background:   "var(--bg-card)",
                  border:       "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding:      "12px 16px",
                  fontSize:     14,
                }}
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
              </div>
            ))}
          </div>
        </>
      )}

      <TrendsBySport from={from} to={to} />
    </>
  );
}
