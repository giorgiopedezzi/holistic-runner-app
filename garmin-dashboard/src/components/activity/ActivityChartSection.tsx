import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import {
  fmtMetricValue, axisDomainMinMax, xTickFormatter,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import type { TrackPoint } from "@/types/api";
import { speedUnitLabel } from "@/utils/units";
import { axisStyle, gridStyle, METRIC_DEFS, OPTIONAL_METRIC_ORDER, AXIS_SIDE, SPEED_AXIS_TEXT_COLOR } from "./shared";
import { MetricRow } from "./MetricRow";
import { TrackTooltip } from "./TrackTooltip";
import { PauseFlagShape } from "./PauseFlagShape";
import { HrRecoveryFlagShape } from "./HrRecoveryFlagShape";

// Chart controls + the main multi-metric overlay chart + per-metric
// standalone cards — split out of ActivityDetailBody (HRA-74) to keep both
// files under the 300 LOC cap. Pure move: every prop here is a value/setter
// ActivityDetailBody already computed; no logic changed.
interface ActivityChartSectionProps {
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
  axisVisible: Record<OptionalMetricKey, boolean>;
  showCard: Record<MetricKey, boolean>;
  toggleMetric: (key: OptionalMetricKey) => void;
  toggleAxis: (key: OptionalMetricKey) => void;
  toggleCard: (key: MetricKey) => void;
}

export function ActivityChartSection({
  displayTrack, chartData, hrRecoveryChartData,
  xMode, setXMode, pauseThreshold, setPauseThreshold, removeOutliers, setRemoveOutliers,
  speedMode, setSpeedMode, speedDomain,
  activeMetrics, effectiveActive, availableMetrics, axisVisible, showCard,
  toggleMetric, toggleAxis, toggleCard,
}: ActivityChartSectionProps) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["distance", "time"] as XMode[]).map(m => (
            <button key={m} onClick={() => setXMode(m)}
              style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${xMode === m ? "var(--border-strong)" : "transparent"}`,
                background: xMode === m ? "var(--bg-card)" : "transparent",
                color: xMode === m ? "var(--text-primary)" : "var(--text-muted)",
              }}>
              {m === "distance" ? "Distance" : "Time"}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          Highlight pauses ≥
          <input type="number" min={5} step={5} value={pauseThreshold}
            onChange={e => setPauseThreshold(Math.max(0, Number(e.target.value)))}
            style={{ width: 56, fontSize: 11, padding: "2px 6px" }} />
          sec
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}
          title="Drops isolated bad samples (GPS/sensor noise) from Speed/Pace and Cadence, plus any Speed/Pace sample slower than walking pace — thresholds adjustable in Settings">
          <input type="checkbox" checked={removeOutliers} onChange={e => setRemoveOutliers(e.target.checked)} />
          Remove outliers
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        {/* Speed/Pace: one column, always active, axis always
            visible (mandatory metric — no on/off toggle, unlike
            the optional metrics below). One pill, split into two
            clickable halves (not a separate label + switch) — the
            selected half reads brighter/lighter, the other dims. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{
            display: "inline-flex", borderRadius: 999, overflow: "hidden",
            border: `1px solid ${METRIC_DEFS.speed.color}`,
          }}>
            {(["speed", "pace"] as SpeedMode[]).map(m => (
              <button key={m} onClick={() => setSpeedMode(m)}
                style={{
                  fontSize: 11, padding: "4px 12px", border: "none", cursor: "pointer",
                  background: speedMode === m ? `${METRIC_DEFS.speed.color}33` : "transparent",
                  color: speedMode === m ? METRIC_DEFS.speed.color : "var(--text-secondary)",
                  fontWeight: speedMode === m ? 600 : 400,
                }}>
                {m === "speed" ? `Speed (${speedUnitLabel()})` : "Pace (mm:ss)"}
              </button>
            ))}
          </div>
        </div>

        {/* Other metrics: three columns, three per row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: 12 }}>
          {OPTIONAL_METRIC_ORDER.map(key => (
            <MetricRow
              key={key}
              mKey={key}
              label={METRIC_DEFS[key].label}
              state={{
                active:    activeMetrics.includes(key),
                available: availableMetrics[key],
                axisOn:    axisVisible[key],
                cardOn:    showCard[key],
              }}
              onToggle={field => {
                if (field === "active") toggleMetric(key);
                else if (field === "axis") toggleAxis(key);
                else toggleCard(key);
              }}
            />
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        {/* top:16 gives the pause-flag pill (a 14px-tall shape
            centered exactly on the y=1 point at the very top of
            its own [0,1] axis) room to render fully — Recharts'
            default ~5px top margin put half the pill above the
            SVG's own top edge, silently clipping it. */}
        <ComposedChart data={chartData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid vertical={false} {...gridStyle} />
          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
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
          {/* Optional metrics' axes, each independently toggleable
              — all on the right (AXIS_SIDE), never sharing Speed's
              side on the left. */}
          {activeMetrics.map(key => (
            <YAxis key={key} yAxisId={key} hide={!axisVisible[key]} orientation={AXIS_SIDE[key]}
              domain={axisDomainMinMax(displayTrack, key, speedMode)}
              tick={{ fill: METRIC_DEFS[key].color, fontSize: 9 }}
              tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)}
              width={axisVisible[key] ? 42 : 0} />
          ))}
          <Tooltip content={<TrackTooltip xMode={xMode} metrics={effectiveActive} speedMode={speedMode} />} />
          {effectiveActive.map(key => (
            <Line key={key} yAxisId={key} dataKey={key} stroke={METRIC_DEFS[key].color}
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
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              {key === "speed" ? (speedMode === "speed" ? "Speed" : "Pace") : METRIC_DEFS[key].label}
              {key === "heart_rate" && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>flags show HR recovery across each pause</span>}
            </div>
            <ResponsiveContainer width="100%" height={110}>
              {/* Same top-margin fix as the main overlay chart —
                  the HR recovery flag plots at the axis's own max
                  value, which sits at the very top pixel row
                  regardless of the domain's data-space padding. */}
              <ComposedChart data={cardData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid vertical={false} {...gridStyle} />
                <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
                  tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
                <YAxis yAxisId="main" domain={domain} tick={axisStyle} tickLine={false} axisLine={false} width={42}
                  tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)} />
                <Tooltip content={<TrackTooltip xMode={xMode} metrics={[key]} speedMode={speedMode} />} />
                <Line yAxisId="main" dataKey={key} stroke={METRIC_DEFS[key].color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
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
          </div>
        );
      })}
    </div>
  );
}
