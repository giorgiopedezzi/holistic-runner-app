import { forwardRef, useImperativeHandle, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { fmtKm } from "@/utils/fmt";
import { fmtPauseDuration } from "@/domain/pauses";
import {
  metricUnit, fmtMetricValue, fmtElapsedClock,
  type ChartRow, type MetricKeyWithStamina, type SpeedMode, type XMode,
} from "@/domain/activity-chart";
import { METRIC_DEFS, METRIC_LABEL_SHORT } from "./shared";

export interface RunnerReadoutHandle {
  show(row: ChartRow): void;
  hide(): void;
}

interface RunnerReadoutProps {
  xMode: XMode;
  // MetricKeyWithStamina, not the real MetricKey (HRA-315): stamina isn't
  // part of MetricKey/METRIC_DEFS/METRIC_LABEL_SHORT yet (HRA-316 folds it
  // in once it picks a chart color/axis side) — this component only ever
  // renders whatever ChartRow fields its caller populated, so it can accept
  // the extra key without touching those Records; see the "stamina" branch
  // below for the local label/color fallback that keeps this additive.
  metrics: MetricKeyWithStamina[];
  speedMode: SpeedMode;
  // Resolves a pause break row's HR just before stopping / just after
  // resuming — a function rather than pre-baked fields on ChartRow, since
  // that lookup needs displayTrack (not available to this component) and is
  // only ever needed for whichever single pause row is currently shown.
  pauseHr: (row: ChartRow) => { before: number | null; after: number | null };
}

// Fixed position — horizontally centered, just above the chart's bottom
// x-axis tick labels (`.hra-runner-values` in index.css) — rather than
// tracking the cursor/runner's x position: a readout that itself moves
// while its numbers are also constantly changing (as during autoplay) is
// harder to read than one that sits still. Bare text, deliberately no
// box/background (see that class's comment) — the width was never fixed
// even when there was a box, and there's nothing left here to overflow.
// Same isolated-local-state pattern as RunnerIcon: a hover/playback update
// only re-renders this component.
export const RunnerReadout = forwardRef<RunnerReadoutHandle, RunnerReadoutProps>(function RunnerReadout(
  { xMode, metrics, speedMode, pauseHr }, ref,
) {
  const { t } = useTranslation();
  const [row, setRow] = useState<ChartRow | null>(null);

  useImperativeHandle(ref, () => ({
    show: r => setRow(r),
    hide: () => setRow(null),
  }), []);

  if (!row) return null;

  let content: React.ReactNode;
  if (row.pauseDurationSec != null) {
    const { before, after } = pauseHr(row);
    const delta = before != null && after != null ? after - before : null;
    const pauseDurationStr = fmtPauseDuration(row.pauseDurationSec);
    content = (
      <>
        {t("activity.runner.paused", `⏸ Paused ${pauseDurationStr}`, { duration: pauseDurationStr })}
        {before != null && after != null && (
          <>
            <span className="hra-chart-tooltip-sep">·</span>
            <span className="hra-chart-tooltip-hr">
              {(() => {
                const b = Math.round(before), a = Math.round(after), d = `${delta! >= 0 ? "+" : ""}${Math.round(delta!)}`;
                return t("activity.runner.hrRecovery", `HR ${b}→${a} (${d})`, { before: b, after: a, delta: d });
              })()}
            </span>
          </>
        )}
      </>
    );
  } else if (row.realX == null) {
    return null;
  } else {
    content = (
      <>
        <span className="hra-chart-tooltip-label">
          {xMode === "time" ? fmtElapsedClock(row.realX) : fmtKm(row.realX)}
        </span>
        {metrics.map(key => {
          const v = row[key];
          if (typeof v !== "number") return null;
          const label = key === "speed"
            ? (speedMode === "speed" ? t("activity.readout.speed", "speed") : t("activity.readout.pace", "pace"))
            // "stamina" short label/color: a local fallback, not an addition
            // to shared.ts's METRIC_LABEL_SHORT/METRIC_DEFS (Records keyed
            // off the real MetricKey union — HRA-316's job, not this
            // Story's, see the metrics prop comment above).
            : key === "stamina" ? t("activity.metricShort.stamina", "Sta")
            : t(`activity.metricShort.${key}`, METRIC_LABEL_SHORT[key]);
          const unit = key === "heart_rate" ? "" : ` ${metricUnit(key, speedMode)}`;
          // No validated chart color for stamina yet (HRA-316 picks one) —
          // reuse the app's own --accent token as a neutral stand-in rather
          // than inventing an ad-hoc hex value here.
          const color = key === "stamina" ? "var(--accent)" : METRIC_DEFS[key].color;
          return (
            <span key={key} className="contents">
              <span className="hra-chart-tooltip-sep">·</span>
              <span className="hra-dyn-color font-semibold" style={{ "--dyn-color": color } as CSSProperties}>
                {label} {fmtMetricValue(key, v, speedMode)}{unit}
              </span>
            </span>
          );
        })}
      </>
    );
  }

  return <div className="hra-runner-values">{content}</div>;
});
