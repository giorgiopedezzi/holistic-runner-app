import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { fmtKm } from "@/utils/fmt";
import { fmtPauseDuration } from "@/domain/pauses";
import {
  metricUnit, fmtMetricValue, fmtElapsedClock,
  type MetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";
import { METRIC_DEFS } from "./shared";

export function TrackTooltip({ active, payload, xMode, metrics, speedMode }: {
  active?: boolean; payload?: Array<{ payload: ChartRow }>;
  xMode: XMode; metrics: MetricKey[]; speedMode: SpeedMode;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  if (row.pauseDurationSec != null) {
    return (
      <div className="hra-chart-tooltip">
        <div className="py-1.5 px-2.5">{(() => {
          const duration = fmtPauseDuration(row.pauseDurationSec);
          return t("activity.runner.paused", `⏸ Paused ${duration}`, { duration });
        })()}</div>
      </div>
    );
  }
  if (row.realX == null) return null;

  return (
    <div className="hra-chart-tooltip">
      <div className="py-1.5 px-2.5">
        <div className="hra-text-muted mb-1">
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
