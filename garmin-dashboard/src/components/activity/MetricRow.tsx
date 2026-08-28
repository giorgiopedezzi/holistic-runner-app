import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { MetricKey } from "@/domain/activity-chart";
import { Checkbox } from "@/components/ui";
import { METRIC_DEFS } from "./shared";

export interface MetricRowState {
  active:    boolean;
  available: boolean;
  cardOn:    boolean;
}

export type MetricRowField = "active" | "card";

// ── Per-metric row: pill (toggles it on/off) + card switch. Used for the
// optional metrics only — Speed/Pace is always active and has its own
// inline layout (unit switch instead of an on/off pill). Per-metric axis
// visibility is no longer a user choice here (dashboard design-system
// rework, "reorganize activity layout": Heart rate's Y-axis is always
// shown when active, Cadence/Power's never is) — see
// ActivityChartSection.tsx's per-metric YAxis rendering.
// One `state` object + one discriminated `onToggle`, not 3 boolean props +
// 2 parallel callbacks (HRA-75, architecture-avoid-boolean-props) — the
// caller still owns activeMetrics/showCard independently, this just
// collapses how they're threaded through one component's props.
export function MetricRow({ mKey, label, state, onToggle }: {
  mKey: MetricKey; label: string; state: MetricRowState; onToggle: (field: MetricRowField) => void;
}) {
  const { t } = useTranslation();
  const { active, available, cardOn } = state;
  const color = METRIC_DEFS[mKey].color;
  return (
    <div className="flex items-center gap-2 py-0.75 flex-wrap">
      <button
        onClick={() => onToggle("active")}
        disabled={!available}
        title={available ? undefined : t("activity.metric.noData", "No data for this metric")}
        className="hra-metric-toggle hra-dyn-border hra-dyn-bg hra-dyn-color text-meta py-1 px-2.5 rounded-full text-left"
        data-active={active}
        style={{ "--metric-color": color } as CSSProperties}
      >
        {label}
      </button>
      {/* Always rendered, not just while active (dashboard design-system
          rework: "card checkbox are always visible, unchecked if metric is
          not selected to be shown") — disabled + forced unchecked while the
          metric itself is off, since its standalone card never renders
          regardless of cardOn's stored value in that state (see
          ActivityChartSection.tsx's effectiveActive.filter(showCard) gate). */}
      <label className="hra-metric-card-toggle hra-text-muted flex items-center gap-1 text-meta" data-active={active}>
        <Checkbox size={11} checked={active && cardOn} onCheckedChange={() => onToggle("card")} disabled={!active} /> {t("activity.metric.card", "Card")}
      </label>
    </div>
  );
}
