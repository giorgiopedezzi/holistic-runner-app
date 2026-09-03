import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaChart, Area, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  ComposedChart, Line, Legend, ReferenceLine,
} from "recharts";
import { useQuery } from "@/hooks/useQuery";
import { useUrlState } from "@/hooks/useUrlState";
import { api } from "@/api/client";
import {
  ChartCard, chartGrid, chartTick, chartTooltipStyle, chartBarRadius, chartGradientDef,
  Stat, StatGrid, SectionTitle, Empty, ErrorBanner, LoadingSpinner, RangeEmpty, Checkbox,
} from "@/components/ui";
import { fmtWeight, fmtPercent, fmtDate } from "@/utils/fmt";
import { ALL_SENTINEL } from "@/utils/date";
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
  urlKey?: string; // when set, persists the chart/table toggle to this URL param (HRA-195)
}

function MetricChartCard({ title, chartData, tableData, series, deltaMode, emptyMessage, urlKey }: MetricChartCardProps) {
  const { t } = useTranslation();
  // Only the primary chart (urlKey set) persists to the URL (HRA-195) — the
  // per-metric extra cards below it are dynamically added/removed by
  // activeOthers, so there's no stable key to persist them under.
  const [localView, setLocalView] = useState<"chart" | "table">("chart");
  const [urlView, setUrlView] = useUrlState(urlKey ?? "bodyView", "chart");
  const view = urlKey ? (urlView === "table" ? "table" : "chart") : localView;
  const setView = urlKey ? setUrlView : setLocalView;

  return (
    <div className="mb-6">
      <div className="hra-row-between">
        <div className="hra-text-secondary text-label font-medium">{title}</div>
        <div className="hra-segment">
          <button className="hra-segment-item" data-active={view === "chart"} onClick={() => setView("chart")}>{t("body.chart.chartView", "Chart")}</button>
          <button className="hra-segment-item" data-active={view === "table"} onClick={() => setView("table")}>{t("body.chart.tableView", "Table")}</button>
        </div>
      </div>

      <ChartCard>
        {series.length === 0 ? (
          <Empty message={emptyMessage ?? t("body.chart.selectMetric", "Select at least one metric above to plot.")} />
        ) : view === "chart" ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                {series.map(s => chartGradientDef(`bodyGrad-${s.key}`, s.color))}
              </defs>
              <CartesianGrid {...gridStyle} />
              <XAxis dataKey="date_only" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={fmtDate} />
              <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
              {deltaMode && <ReferenceLine y={0} stroke="var(--border-strong)" />}
              <Tooltip
                {...tooltipStyle}
                labelFormatter={label => fmtDate(String(label))}
                formatter={(v: unknown, _name: unknown, entry: unknown) => {
                  const key = entry && typeof entry === "object" && "dataKey" in entry ? (entry as { dataKey?: string }).dataKey : undefined;
                  const s = series.find(s => s.key === key);
                  if (typeof v !== "number") return String(v ?? "");
                  const sign = deltaMode && v >= 0 ? "+" : "";
                  return `${sign}${v.toFixed(1)}${s?.unit ? ` ${s.unit}` : ""}`;
                }}
              />
              {/* wrapperStyle is a Recharts passthrough prop with no className
                  equivalent — this can't move to a class, unlike every other
                  style={{}} in this file. */}
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />}
              {series.map(s => (
                <Area key={s.key} dataKey={s.key} stroke={s.color} fill={`url(#bodyGrad-${s.key})`} strokeWidth={2} dot={false} name={s.label} connectNulls />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="max-h-65 overflow-auto">
            <table className="w-full border-collapse text-meta">
              <thead>
                <tr>
                  <th className="hra-text-muted hra-border-bottom hra-bg-card sticky top-0 py-1.5 px-2 text-left">{t("body.chart.dateColumn", "Date")}</th>
                  {series.map(s => (
                    <th key={s.key} className="hra-text-muted hra-border-bottom hra-bg-card sticky top-0 py-1.5 px-2 text-right">
                      {s.label}{s.unit ? ` (${s.unit})` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, i) => (
                  <tr key={i}>
                    <td className="hra-text-secondary hra-border-bottom py-1.25 px-2">{fmtDate(row.date_only)}</td>
                    {series.map(s => {
                      const v = row[s.key];
                      return (
                        <td key={s.key} className="hra-text-primary hra-border-bottom py-1.25 px-2 text-right">
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
  const { t } = useTranslation();
  // "All available data" reads as an intentional range, not the useDateRange
  // "All" preset's internal 2000-01-01 sentinel (HRA-256).
  const fromLabel = from === ALL_SENTINEL ? t("dateRange.allAvailable", "All available data") : from;
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

  if (isLoading) return <LoadingSpinner label={t("body.loading", "Loading body measurements…")} />;
  if (error)     return <ErrorBanner message={error.error} />;

  if (list.length === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel={t("common.entity.bodyMeasurements", "body measurements")} />;
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
  const primarySeries: Series[] = primaryKeys.map(k => ({ key: k, ...METRIC_DEFS[k], label: t(`body.metric.${k}`, METRIC_DEFS[k].label), unit: metricUnit(k) }));
  // Delta computed in kg first (computeKgDelta works from the raw list),
  // converted to lb only at the end — kgToLb is a pure linear scale (no
  // offset), so converting the delta directly is equivalent to converting
  // both endpoints first and re-subtracting.
  const primaryChartData = computeKgDelta(list, primaryKeys).map(convertRow);
  const displayList = list.map(convertRow);

  const checkbox = (label: string, checked: boolean, onChange: () => void, color: string) => (
    <label className="hra-dyn-color flex items-center gap-1 text-meta cursor-pointer" style={{ "--dyn-color": checked ? color : "var(--text-secondary)" } as CSSProperties}>
      <Checkbox checked={checked} onCheckedChange={onChange} color={color} />
      {label}
    </label>
  );

  return (
    <>
      <SectionTitle>{t("body.latestMeasurementTitle", `Latest measurement — ${fmtDate(latest.date_only)}`, { date: fmtDate(latest.date_only) })}</SectionTitle>
      <StatGrid>
        <Stat label={t("body.stat.weight", "Weight")} value={fmtWeight(latest.weight_kg)} accent="var(--data-weight)" />
        {latest.fat_ratio      && <Stat label={t("body.stat.bodyFat", "Body fat")} value={fmtPercent(latest.fat_ratio)} />}
        {latest.muscle_mass_kg && <Stat label={t("body.stat.muscleMass", "Muscle mass")} value={fmtWeight(latest.muscle_mass_kg)} accent="var(--accent-green)" />}
        {latest.bmi            && <Stat label={t("body.stat.bmi", "BMI")} value={latest.bmi.toFixed(1)} />}
        {weightDelta !== null  && (
          <Stat
            label={t("body.stat.changeInPeriod", "Change in period")}
            value={`${weightDelta > 0 ? "+" : ""}${(getUnitSystem() === "imperial" ? kgToLb(weightDelta) : weightDelta).toFixed(1)} ${weightUnitLabel()}`}
            accent={weightDelta <= 0 ? "var(--accent-green)" : "var(--accent-red)"}
          />
        )}
      </StatGrid>

      <SectionTitle>{t("body.metricsSectionTitle", `Body metrics — ${fromLabel} to ${to}`, { from: fromLabel, to })}</SectionTitle>

      <div className="hra-border-strong inline-flex gap-3.5 items-center py-1.5 px-3.5 rounded-full mb-4">
        {checkbox(t("body.metric.weight_kg", METRIC_DEFS.weight_kg.label), showWeight, () => setShowWeight(v => !v), METRIC_DEFS.weight_kg.color)}
        {checkbox(t("body.metric.fat_mass_kg", METRIC_DEFS.fat_mass_kg.label), showFatMass, () => setShowFatMass(v => !v), METRIC_DEFS.fat_mass_kg.color)}
        {checkbox(t("body.metric.muscle_mass_kg", METRIC_DEFS.muscle_mass_kg.label), showMuscleMass, () => setShowMuscleMass(v => !v), METRIC_DEFS.muscle_mass_kg.color)}
      </div>

      <MetricChartCard
        title={t("body.primaryChartTitle", `Weight, fat mass & muscle mass — change since start of range (${weightUnitLabel()})`, { unit: weightUnitLabel() })}
        chartData={primaryChartData}
        tableData={displayList}
        series={primarySeries}
        deltaMode
        emptyMessage={t("body.chart.checkMetric", "Check at least one metric above to plot.")}
        urlKey="bodyView"
      />

      <div className="flex gap-1.5 flex-wrap mb-4">
        {OTHER_METRICS.map(key => {
          const def = METRIC_DEFS[key];
          const isActive = activeOthers.includes(key);
          const available = list.some(m => m[key] != null);
          return (
            <button
              key={key}
              disabled={!available}
              onClick={() => setActiveOthers(a => isActive ? a.filter(k => k !== key) : [...a, key])}
              title={available ? undefined : t("body.chart.noDataInRange", "No data for this metric in range")}
              className="hra-metric-toggle hra-dyn-border hra-dyn-bg hra-dyn-color text-meta py-1 px-2.5 rounded-full"
              data-active={isActive}
              style={{ "--metric-color": def.color } as CSSProperties}
            >
              {t(`body.metric.${key}`, def.label)}
            </button>
          );
        })}
      </div>

      {activeOthers.map(key => {
        const unit = metricUnit(key);
        const label = t(`body.metric.${key}`, METRIC_DEFS[key].label);
        return (
          <MetricChartCard
            key={key}
            title={unit ? `${label} (${unit})` : label}
            chartData={displayList}
            tableData={displayList}
            series={[{ key, ...METRIC_DEFS[key], label, unit }]}
          />
        );
      })}

      <SectionTitle>{t("body.correlationSectionTitle", `Running ${distanceUnitLabel()} vs weight (weekly)`, { unit: distanceUnitLabel() })}</SectionTitle>
      {!correlation || correlation.length === 0 ? (
        <Empty message={t("body.correlationEmpty", "No overlapping activity/body data for correlation in this range.")} />
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
              <Bar    yAxisId="km" dataKey="km"         fill="var(--accent-green)"  radius={chartBarRadius} name={t("body.correlation.distanceLegend", `${distanceUnitLabel()} run`, { unit: distanceUnitLabel() })} barSize={14} />
              <Line   yAxisId="kg" dataKey="avg_weight" stroke="var(--data-weight)" strokeWidth={2} dot={false} name={t("body.correlation.weightLegend", `avg weight ${weightUnitLabel()}`, { unit: weightUnitLabel() })} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </>
  );
}
