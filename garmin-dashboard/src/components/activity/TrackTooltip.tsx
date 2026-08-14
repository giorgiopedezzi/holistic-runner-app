import { fmtKm } from "@/utils/fmt";
import { fmtPauseDuration } from "@/domain/pauses";
import {
  metricUnit, fmtMetricValue, fmtElapsedClock,
  type MetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import { METRIC_DEFS, ttStyle } from "./shared";

export function TrackTooltip({ active, payload, xMode, metrics, speedMode }: {
  active?: boolean; payload?: Array<{ payload: ChartRow }>;
  xMode: XMode; metrics: MetricKey[]; speedMode: SpeedMode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  if (row.pauseDurationSec != null) {
    return (
      <div style={ttStyle.contentStyle}>
        <div style={{ padding: "6px 10px" }}>⏸ Paused {fmtPauseDuration(row.pauseDurationSec)}</div>
      </div>
    );
  }
  if (row.realX == null) return null;

  return (
    <div style={ttStyle.contentStyle}>
      <div style={{ padding: "6px 10px" }}>
        <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
          {xMode === "time" ? fmtElapsedClock(row.realX) : fmtKm(row.realX)}
        </div>
        {metrics.map(key => {
          const v = row[key];
          if (typeof v !== "number") return null;
          return (
            <div key={key} style={{ color: METRIC_DEFS[key].color }}>
              {key === "speed" ? (speedMode === "speed" ? "Speed" : "Pace") : METRIC_DEFS[key].label}: {fmtMetricValue(key, v, speedMode)} {metricUnit(key, speedMode)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
