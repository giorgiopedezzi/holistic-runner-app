import { useState } from "react";
import type { CSSProperties } from "react";
import {
  LineChart, Line, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  ComposedChart, Legend, ReferenceLine,
} from "recharts";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/api/client";
import { Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, RangeEmpty } from "@/components/ui";
import type { BodyMeasurement } from "@/types/api";
import { fmtWeight, fmtPercent } from "@/utils/fmt";
import { getUnitSystem, kgToLb, kmToMi, weightUnitLabel, distanceUnitLabel } from "@/utils/units";

interface Props { from: string; to: string; }

const axisStyle = { fill: "var(--text-muted)", fontSize: 11 };
const gridStyle = { stroke: "var(--border)", strokeDasharray: "3 3" };
const chartWrap = {
  background:   "var(--bg-card)",
  border:       "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding:      "16px 8px 8px",
};
const tooltipStyle = {
  contentStyle: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  },
};

// ── Metric definitions ───────────────────────────────────────────────────
// Colors are this app's existing accent hues, snapped to the nearest step
// that clears the dataviz skill's categorical validator (lightness band +
// CVD separation) against this chart's dark surface (--bg-card, #1e2330) —
// e.g. the raw --accent-orange/--accent-green are too light for the
// dark-mode band, so fat_ratio/muscle_mass_kg use darker validated variants
// instead of the exact CSS vars. Validated together as one 8-color set so
// each metric's color stays fixed regardless of which chart it appears in
// ("color follows the entity, never its row number").
type PrimaryKey = "weight_kg" | "fat_mass_kg" | "muscle_mass_kg";
type OtherKey    = "fat_ratio" | "bone_mass_kg" | "hydration_kg" | "bmi" | "heart_rate";
type MetricKey   = PrimaryKey | OtherKey;

// Row shape both the raw BodyMeasurement list and the computed delta rows
// satisfy structurally (every MetricKey is a real BodyMeasurement field).
type MetricRow = { date_only: string } & Partial<Record<MetricKey, number | null>>;

const OTHER_METRICS: OtherKey[] = ["fat_ratio", "bone_mass_kg", "hydration_kg", "bmi", "heart_rate"];

// `unit` here is the metric-system label — WEIGHT_KEYS below overrides it
// with weightUnitLabel() dynamically wherever these defs are actually used,
// since a static "kg" can't reflect a unit system the user can change at
// runtime. Kept as "kg" here anyway so METRIC_DEFS stays a plain, readable
// static table; nothing reads .unit directly for a WEIGHT_KEYS member.
const METRIC_DEFS: Record<MetricKey, { label: string; color: string; unit: string }> = {
  weight_kg:      { label: "Weight",      color: "var(--accent-blue)", unit: "kg" },
  fat_mass_kg:    { label: "Fat mass",    color: "#db2777",            unit: "kg" },
  muscle_mass_kg: { label: "Muscle mass", color: "#15965f",            unit: "kg" },
  fat_ratio:      { label: "Fat %",       color: "#d97706",            unit: "%" },
  bone_mass_kg:   { label: "Bone mass",   color: "#a855f7",            unit: "kg" },
  hydration_kg:   { label: "Hydration",   color: "#0891b2",            unit: "kg" },
  bmi:            { label: "BMI",         color: "#65a30d",            unit: "" },
  heart_rate:     { label: "Heart rate",  color: "var(--accent-red)",  unit: "bpm" },
};

const WEIGHT_KEYS = new Set<MetricKey>(["weight_kg", "fat_mass_kg", "muscle_mass_kg", "bone_mass_kg", "hydration_kg"]);

function metricUnit(key: MetricKey): string {
  return WEIGHT_KEYS.has(key) ? weightUnitLabel() : METRIC_DEFS[key].unit;
}

// Converts every weight-family field present in a row to lb when imperial
// is active — used on chart/table data, which format values with their own
// .toFixed(1) rather than going through fmt.ts's self-converting fmtWeight
// (that's still used as-is for the plain Stat cards above, which must NOT
// also be pre-converted here or they'd double-convert).
function convertRow(row: MetricRow): MetricRow {
  if (getUnitSystem() !== "imperial") return row;
  const out: MetricRow = { ...row };
  for (const k of WEIGHT_KEYS) {
    const v = out[k];
    if (v != null) out[k] = kgToLb(v);
  }
  return out;
}

// Delta (kg change from the first reading in range) — not raw values — is
// specifically what makes weight/fat mass/muscle mass comparable on one
// shared axis despite their very different absolute magnitudes (~80kg vs
// ~13kg vs ~65kg): the *changes* are typically much closer in size than the
// absolute values are, and since weight ≈ fat mass + muscle mass + water +
// bone, plotting their deltas together directly shows how a weight change
// decomposes into fat vs muscle. This is the one case in this file where
// sharing an axis across different-magnitude series is the point, not a
// distortion — contrast with the "other" metrics below, which stay in real
// units on their own independent charts (see the anti-patterns note in the
// previous version of this file re: dual/multi-axis).
function computeKgDelta(list: BodyMeasurement[], keys: PrimaryKey[]): MetricRow[] {
  const baseline: Partial<Record<PrimaryKey, number>> = {};
  for (const k of keys) {
    const first = list.find(m => m[k] != null);
    if (first) baseline[k] = first[k] as number;
  }
  return list.map(m => {
    const row: MetricRow = { date_only: m.date_only };
    for (const k of keys) {
      const v = m[k];
      const base = baseline[k];
      row[k] = base != null && v != null ? v - base : null;
    }
    return row;
  });
}

// ── Chart card: a chart with a per-card Chart/Table toggle ──────────────
interface Series { key: MetricKey; label: string; color: string; unit: string; }

interface MetricChartCardProps {
  title:      string;
  chartData:  MetricRow[];
  tableData:  MetricRow[];
  series:     Series[];
  deltaMode?: boolean; // shows a 0 reference line and +/- signed values
  emptyMessage?: string;
}

function MetricChartCard({ title, chartData, tableData, series, deltaMode, emptyMessage }: MetricChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");

  const tabBtn = (isActive: boolean): CSSProperties => ({
    fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${isActive ? "var(--border-strong)" : "transparent"}`,
    background: isActive ? "var(--surface-1, var(--bg-surface))" : "transparent",
    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
  });

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{title}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setView("chart")} style={tabBtn(view === "chart")}>Chart</button>
          <button onClick={() => setView("table")} style={tabBtn(view === "table")}>Table</button>
        </div>
      </div>

      <div style={chartWrap}>
        {series.length === 0 ? (
          <Empty message={emptyMessage ?? "Select at least one metric above to plot."} />
        ) : view === "chart" ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid vertical={false} {...gridStyle} />
              <XAxis dataKey="date_only" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              {deltaMode && <ReferenceLine y={0} stroke="var(--border-strong)" />}
              <Tooltip
                {...tooltipStyle}
                formatter={(v: unknown, _name: unknown, entry: unknown) => {
                  const key = entry && typeof entry === "object" && "dataKey" in entry ? (entry as { dataKey?: string }).dataKey : undefined;
                  const s = series.find(s => s.key === key);
                  if (typeof v !== "number") return String(v ?? "");
                  const sign = deltaMode && v >= 0 ? "+" : "";
                  return `${sign}${v.toFixed(1)}${s?.unit ? ` ${s.unit}` : ""}`;
                }}
              />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />}
              {series.map(s => (
                <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} name={s.label} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)" }}>Date</th>
                  {series.map(s => (
                    <th key={s.key} style={{ textAlign: "right", padding: "6px 8px", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-card)" }}>
                      {s.label}{s.unit ? ` (${s.unit})` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: "5px 8px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{row.date_only}</td>
                    {series.map(s => {
                      const v = row[s.key];
                      return (
                        <td key={s.key} style={{ textAlign: "right", padding: "5px 8px", color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}>
                          {typeof v === "number" ? v.toFixed(1) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function BodyTab({ from, to }: Props) {
  const listQ        = useQuery(() => api.body.list(from, to),        [from, to]);
  const correlationQ = useQuery(() => api.body.correlation(from, to), [from, to]);
  const rangeQ       = useQuery(() => api.body.range(),               []);

  const [showWeight, setShowWeight]           = useState(true);
  const [showFatMass, setShowFatMass]         = useState(true);
  const [showMuscleMass, setShowMuscleMass]   = useState(true);
  const [activeOthers, setActiveOthers]       = useState<OtherKey[]>([]);

  const isLoading = [listQ, correlationQ].some(q => q.state.status === "loading");
  const error     = [listQ, correlationQ]
    .find(q => q.state.status === "error")
    ?.state as { status: "error"; error: string } | undefined;

  const list        = listQ.state.status        === "success" ? listQ.state.data        : [];
  const correlation = correlationQ.state.status === "success" ? correlationQ.state.data : null;

  if (isLoading) return <LoadingSpinner />;
  if (error)     return <ErrorBanner message={error.error} />;

  if (list.length === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel="body measurements" />;
  }

  // latest measurement
  const latest = list[list.length - 1];
  // trend: compare first vs last weight
  const oldest = list[0];
  const weightDelta = latest.weight_kg && oldest.weight_kg
    ? latest.weight_kg - oldest.weight_kg : null;

  const primaryKeys: PrimaryKey[] = [
    ...(showWeight ? (["weight_kg"] as const) : []),
    ...(showFatMass ? (["fat_mass_kg"] as const) : []),
    ...(showMuscleMass ? (["muscle_mass_kg"] as const) : []),
  ];
  const primarySeries: Series[] = primaryKeys.map(k => ({ key: k, ...METRIC_DEFS[k], unit: metricUnit(k) }));
  // Delta computed in kg first (computeKgDelta works from the raw list),
  // converted to lb only at the end — kgToLb is a pure linear scale (no
  // offset), so converting the delta directly is equivalent to converting
  // both endpoints first and re-subtracting.
  const primaryChartData = computeKgDelta(list, primaryKeys).map(convertRow);
  const displayList = list.map(convertRow);

  const checkbox = (label: string, checked: boolean, onChange: () => void, color: string) => (
    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: checked ? color : "var(--text-secondary)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: color, cursor: "pointer" }} />
      {label}
    </label>
  );

  return (
    <>
      <SectionTitle>Latest measurement — {latest.date_only}</SectionTitle>
      <StatGrid>
        <Stat label="Weight"       value={fmtWeight(latest.weight_kg)} accent="var(--accent-blue)" />
        {latest.fat_ratio      && <Stat label="Body fat"    value={fmtPercent(latest.fat_ratio)} />}
        {latest.muscle_mass_kg && <Stat label="Muscle mass" value={fmtWeight(latest.muscle_mass_kg)} accent="var(--accent-green)" />}
        {latest.bmi            && <Stat label="BMI"         value={latest.bmi.toFixed(1)} />}
        {weightDelta !== null  && (
          <Stat
            label="Change in period"
            value={`${weightDelta > 0 ? "+" : ""}${(getUnitSystem() === "imperial" ? kgToLb(weightDelta) : weightDelta).toFixed(1)} ${weightUnitLabel()}`}
            accent={weightDelta <= 0 ? "var(--accent-green)" : "var(--accent-red)"}
          />
        )}
      </StatGrid>

      <SectionTitle>Body metrics — {from} to {to}</SectionTitle>

      <div style={{
        display: "inline-flex", gap: 14, alignItems: "center", padding: "6px 14px",
        borderRadius: 999, border: "1px solid var(--border-strong)", marginBottom: 16,
      }}>
        {checkbox("Weight", showWeight, () => setShowWeight(v => !v), METRIC_DEFS.weight_kg.color)}
        {checkbox("Fat mass", showFatMass, () => setShowFatMass(v => !v), METRIC_DEFS.fat_mass_kg.color)}
        {checkbox("Muscle mass", showMuscleMass, () => setShowMuscleMass(v => !v), METRIC_DEFS.muscle_mass_kg.color)}
      </div>

      <MetricChartCard
        title={`Weight, fat mass & muscle mass — change since start of range (${weightUnitLabel()})`}
        chartData={primaryChartData}
        tableData={displayList}
        series={primarySeries}
        deltaMode
        emptyMessage="Check at least one metric above to plot."
      />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {OTHER_METRICS.map(key => {
          const def = METRIC_DEFS[key];
          const isActive = activeOthers.includes(key);
          const available = list.some(m => m[key] != null);
          return (
            <button
              key={key}
              disabled={!available}
              onClick={() => setActiveOthers(a => isActive ? a.filter(k => k !== key) : [...a, key])}
              title={available ? undefined : "No data for this metric in range"}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 999,
                cursor: available ? "pointer" : "not-allowed",
                opacity: available ? 1 : 0.4,
                border: `1px solid ${isActive ? def.color : "var(--border-strong)"}`,
                background: isActive ? `${def.color}22` : "transparent",
                color: isActive ? def.color : "var(--text-secondary)",
              }}
            >
              {def.label}
            </button>
          );
        })}
      </div>

      {activeOthers.map(key => {
        const unit = metricUnit(key);
        return (
          <MetricChartCard
            key={key}
            title={`${METRIC_DEFS[key].label}${unit ? ` (${unit})` : ""}`}
            chartData={displayList}
            tableData={displayList}
            series={[{ key, ...METRIC_DEFS[key], unit }]}
          />
        );
      })}

      <SectionTitle>Running {distanceUnitLabel()} vs weight (weekly)</SectionTitle>
      {correlation === null ? (
        <Empty message="No overlapping activity/body data for correlation in this range." />
      ) : (
        <div style={chartWrap}>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={correlation.map(c => ({
              ...c,
              km: getUnitSystem() === "imperial" ? kmToMi(c.km) : c.km,
              avg_weight: c.avg_weight != null ? (getUnitSystem() === "imperial" ? kgToLb(c.avg_weight) : c.avg_weight) : null,
            }))}>
              <CartesianGrid vertical={false} {...gridStyle} />
              <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="km"  tick={axisStyle} tickLine={false} axisLine={false} width={32} />
              <YAxis yAxisId="kg"  tick={axisStyle} tickLine={false} axisLine={false} width={40} orientation="right" domain={["auto","auto"]} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
              <Bar    yAxisId="km" dataKey="km"         fill="var(--accent-green)"  radius={[3,3,0,0]} name={`${distanceUnitLabel()} run`} barSize={14} />
              <Line   yAxisId="kg" dataKey="avg_weight" stroke="var(--accent-blue)" strokeWidth={2} dot={false} name={`avg weight ${weightUnitLabel()}`} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
