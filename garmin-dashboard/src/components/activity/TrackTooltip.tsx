import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  if (row.pauseDurationSec != null) {
    return (
      <div style={ttStyle.contentStyle}>
        <div style={{ padding: "6px 10px" }}>{(() => {
          const duration = fmtPauseDuration(row.pauseDurationSec);
          return t("activity.runner.paused", `⏸ Paused ${duration}`, { duration });
        })()}</div>
      </div>
    );
  }
  if (row.realX == null) return null;

  return (
    <div style={ttStyle.contentStyle}>
      <div style={{ padding: "6px 10px" }}>
        <div className="hra-text-muted" style={{ marginBottom: 4 }}>
          {xMode === "time" ? fmtElapsedClock(row.realX) : fmtKm(row.realX)}
        </div>
        {metrics.map(key => {
          const v = row[key];
          if (typeof v !== "number") return null;
          return (
            <div key={key} className="hra-dyn-color" style={{ "--dyn-color": METRIC_DEFS[key].color } as CSSProperties}>
              {key === "speed"
                ? (speedMode === "speed" ? t("activity.metric.speedLabel", "Speed") : t("activity.metric.paceLabel", "Pace"))
                : t(`activity.metric.${key}`, METRIC_DEFS[key].label)}: {fmtMetricValue(key, v, speedMode)} {metricUnit(key, speedMode)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
