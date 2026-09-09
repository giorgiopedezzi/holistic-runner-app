import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ChartSpline } from "lucide-react";

export interface MetricLegendChipState {
  active: boolean;
  available: boolean;
  cardOn: boolean;
}

export type MetricLegendChipField = "active" | "card";

// One optional metric's combined-chart toggle (HRA-292 — replaces MetricRow's
// checkbox+"Card"-label pattern for THIS use only: the HR/Cadence/Power
// series toggles feeding the main chart. MetricRow itself is untouched and
// still used for the Planned-workout pill, a different feature outside this
// Story's scope.)
//
// The chip reuses .hra-legend-chip — the same colored pill-legend class
// ChartPillLegend already defines for other charts (ui/ChartCard.tsx) — so
// this chart's series toggle matches the shared visual language instead of
// inventing a second one; it isn't built on ChartPillLegend itself only
// because that component's one-`onToggle`-per-item shape has no room for the
// second, independent detail-chart control below.
//
// The small icon button beside it is the scope's "separate, explicit
// control for showing/hiding the detailed secondary-chart section" — no
// longer nested inside a checkbox labeled "Card" (internal jargon the Story
// exists to remove). Same always-visible/disabled-while-inactive semantics
// the old Card checkbox had (dashboard design-system rework: "card checkbox
// are always visible, unchecked if metric is not selected to be shown").
export function MetricLegendChip({ label, color, state, onToggle, compact }: {
  label: string; color: string; state: MetricLegendChipState; onToggle: (field: MetricLegendChipField) => void;
  // HRA-303 corrective round, section 4/6: the mobile legend row is "compact
  // dot-and-label legend items" only — no second chart-icon button (that
  // control's job moves to the one secondary-charts disclosure group below
  // the chart instead, see ActivityChartSection.tsx). `onToggle` still only
  // ever receives "active" in this mode; the "card" field/second button
  // simply doesn't exist here, so no caller-side branching is needed.
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { active, available, cardOn } = state;
  const detailLabel = t("activity.metric.detailChart", `${label} detail chart`, { metric: label });

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onToggle("active")}
        disabled={!available}
        title={available ? undefined : t("activity.metric.noData", "No data for this metric")}
        className="hra-legend-chip-compact"
        aria-pressed={active}
        data-active={active}
        style={{ "--legend-color": color } as CSSProperties}
      >
        {/* Solid dot when selected, hollow ring when not — a shape
            difference on top of the color, not color alone (Accessibility:
            "Color cannot be the only indicator of ... selection state"). */}
        <span className="hra-legend-chip-compact-dot" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <div className="hra-metric-legend-row">
      <button
        type="button"
        onClick={() => onToggle("active")}
        disabled={!available}
        title={available ? undefined : t("activity.metric.noData", "No data for this metric")}
        className="hra-legend-chip"
        data-active={active}
        style={{ "--legend-color": color } as CSSProperties}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={() => onToggle("card")}
        disabled={!active}
        aria-pressed={active && cardOn}
        aria-label={detailLabel}
        title={detailLabel}
        className="hra-metric-detail-toggle"
        data-active={active && cardOn}
      >
        <ChartSpline size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
