import { useState } from "react";
import type { CSSProperties } from "react";
import {
  AreaChart, Area, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  ComposedChart, Line, Legend, ReferenceLine,
} from "recharts";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/api/client";
import {
  ChartCard, chartGrid, chartTick, chartTooltipStyle, chartBarRadius, chartGradientDef,
  Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, RangeEmpty, Checkbox,
} from "@/components/ui";
import { fmtWeight, fmtPercent } from "@/utils/fmt";
import { getUnitSystem, kgToLb, kmToMi, weightUnitLabel, distanceUnitLabel } from "@/utils/units";
import {
  type PrimaryKey, type OtherKey, type MetricKey, type MetricRow,
  METRIC_DEFS, metricUnit, convertRow, computeKgDelta,
} from "@/domain/body-metrics";

interface Props { from: string; to: string; }

const axisStyle = chartTick;
const gridStyle = chartGrid;
const tooltipStyle = { contentStyle: chartTooltipStyle };

const OTHER_METRICS: OtherKey[] = ["fat_ratio", "bone_mass_kg", "hydration_kg", "bmi", "heart_rate"];

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

  // Active/inactive visuals are .hra-pill-active/.hra-nav-pill (index.css) —
  // same classes the header nav tabs use — not a computed style object.
  const tabBtnClass = (isActive: boolean) =>
    ["hra-pill", "hra-nav-pill", "hra-nav-hover", isActive ? "hra-pill-active" : ""].filter(Boolean).join(" ");
  const tabBtnStyle: CSSProperties = { fontSize: 11, padding: "3px 10px" };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{title}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={tabBtnClass(view === "chart")} onClick={() => setView("chart")} style={tabBtnStyle}>Chart</button>
          <button className={tabBtnClass(view === "table")} onClick={() => setView("table")} style={tabBtnStyle}>Table</button>
        </div>
      </div>

      <ChartCard>
        {series.length === 0 ? (
          <Empty message={emptyMessage ?? "Select at least one metric above to plot."} />
        ) : view === "chart" ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                {series.map(s => chartGradientDef(`bodyGrad-${s.key}`, s.color))}
              </defs>
              <CartesianGrid {...gridStyle} />
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
                <Area key={s.key} dataKey={s.key} stroke={s.color} fill={`url(#bodyGrad-${s.key})`} strokeWidth={2} dot={false} name={s.label} connectNulls />
              ))}
            </AreaChart>
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
      </ChartCard>
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
      <Checkbox checked={checked} onCheckedChange={onChange} color={color} />
      {label}
    </label>
  );

  return (
    <>
      <SectionTitle>Latest measurement — {latest.date_only}</SectionTitle>
      <StatGrid>
        <Stat label="Weight"       value={fmtWeight(latest.weight_kg)} accent="var(--data-weight)" />
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
                background: isActive ? `color-mix(in srgb, ${def.color} 13%, transparent)` : "transparent",
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
      {!correlation || correlation.length === 0 ? (
        <Empty message="No overlapping activity/body data for correlation in this range." />
      ) : (
        <ChartCard>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={correlation.map(c => ({
              ...c,
              km: getUnitSystem() === "imperial" ? kmToMi(c.km) : c.km,
              avg_weight: c.avg_weight != null ? (getUnitSystem() === "imperial" ? kgToLb(c.avg_weight) : c.avg_weight) : null,
            }))}>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="week" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="km"  tick={axisStyle} tickLine={false} axisLine={false} width={32} />
              <YAxis yAxisId="kg"  tick={axisStyle} tickLine={false} axisLine={false} width={40} orientation="right" domain={["auto","auto"]} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
              <Bar    yAxisId="km" dataKey="km"         fill="var(--accent-green)"  radius={chartBarRadius} name={`${distanceUnitLabel()} run`} barSize={14} />
              <Line   yAxisId="kg" dataKey="avg_weight" stroke="var(--data-weight)" strokeWidth={2} dot={false} name={`avg weight ${weightUnitLabel()}`} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </>
  );
}
