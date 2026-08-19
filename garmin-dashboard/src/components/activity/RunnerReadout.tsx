import { forwardRef, useImperativeHandle, useState, type CSSProperties } from "react";
import { fmtKm } from "@/utils/fmt";
import { fmtPauseDuration } from "@/domain/pauses";
import {
  metricUnit, fmtMetricValue, fmtElapsedClock,
  type ChartRow, type MetricKey, type SpeedMode, type XMode,
} from "@/domain/activity-chart";
import { METRIC_DEFS, METRIC_LABEL_SHORT } from "./shared";

export interface RunnerReadoutHandle {
  show(row: ChartRow): void;
  hide(): void;
}

interface RunnerReadoutProps {
  xMode: XMode;
  metrics: MetricKey[];
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
    content = (
      <>
        ⏸ Paused {fmtPauseDuration(row.pauseDurationSec)}
        {before != null && after != null && (
          <>
            <span className="hra-chart-tooltip-sep">·</span>
            <span className="hra-chart-tooltip-hr">
              HR {Math.round(before)}→{Math.round(after)} ({delta! >= 0 ? "+" : ""}{Math.round(delta!)})
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
          const label = key === "speed" ? (speedMode === "speed" ? "speed" : "pace") : METRIC_LABEL_SHORT[key];
          const unit = key === "heart_rate" ? "" : ` ${metricUnit(key, speedMode)}`;
          return (
            <span key={key} style={{ display: "contents" }}>
              <span className="hra-chart-tooltip-sep">·</span>
              <span className="hra-dyn-color" style={{ "--dyn-color": METRIC_DEFS[key].color, fontWeight: 600 } as CSSProperties}>
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
