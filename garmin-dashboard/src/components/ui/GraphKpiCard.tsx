import type { ReactNode } from "react";
import type { CSSProperties } from "react";

// Main graph header's compact KPI card (subHeader/controlsRow row) —
// deliberately smaller/plainer than Stat's own card, which is sized to stand
// alone in a grid, not sit inline beside a chart title. Vertical: indicator
// (icon + label) on top, value, difference — the one canonical metric-card
// order (docs/frontend.md), same as Stat's own layout. Extracted out of
// OverviewTab.tsx (dashboard design-system rework, "harmonize badges") so
// the activity detail chart can use the exact same shape for its own
// Distance/Speed-Pace KPIs, not a re-implementation.
export function GraphKpiCard({ icon, iconColor, value, unit, label, deltaText, deltaPositive: positive, valueColor }: {
  icon: ReactNode; iconColor: string; value: string; unit?: string; label: string;
  deltaText?: string; deltaPositive?: boolean;
  // Optional per-instance value-text color hook (dashboard design-system
  // rework) — same --x-color pattern as Stat's own `accent` prop, for a
  // badge whose value should use an interpolated color (e.g. the activity
  // detail chart's Avg HR KPI, hrRunnerColor(bpm)) instead of the fixed
  // --text-primary every other GraphKpiCard uses.
  valueColor?: string;
}) {
  return (
    <div className="hra-graph-kpi">
      <div className="hra-graph-kpi-label" style={{ "--kpi-icon-color": iconColor } as CSSProperties}>
        <span className="hra-graph-kpi-icon">{icon}</span>
        {label}
      </div>
      <div className="hra-graph-kpi-value" style={valueColor ? ({ "--graph-kpi-color": valueColor } as CSSProperties) : undefined}>
        {value}{unit && <span className="hra-graph-kpi-unit"> {unit}</span>}
      </div>
      {deltaText && (
        <div className={positive == null ? "hra-stat-delta" : positive ? "hra-stat-delta hra-stat-delta-up" : "hra-stat-delta hra-stat-delta-down"}>
          {positive != null && (positive ? "↗ " : "↘ ")}{deltaText}
        </div>
      )}
    </div>
  );
}
