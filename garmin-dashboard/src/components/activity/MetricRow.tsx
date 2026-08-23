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
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", flexWrap: "wrap" }}>
      <button
        onClick={() => onToggle("active")}
        disabled={!available}
        title={available ? undefined : t("activity.metric.noData", "No data for this metric")}
        className="hra-dyn-border hra-dyn-bg hra-dyn-color"
        style={{
          fontSize: 11, padding: "4px 10px", borderRadius: 999, textAlign: "left",
          cursor: available ? "pointer" : "not-allowed",
          opacity: available ? 1 : 0.4,
          "--dyn-border": active ? color : "var(--border-strong)",
          "--dyn-bg": active ? `color-mix(in srgb, ${color} 13%, transparent)` : "transparent",
          "--dyn-color": active ? color : "var(--text-secondary)",
        } as CSSProperties}
      >
        {label}
      </button>
      {active && (
        <label className="hra-text-muted" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, cursor: "pointer" }}>
          <Checkbox size={11} checked={cardOn} onCheckedChange={() => onToggle("card")} /> {t("activity.metric.card", "Card")}
        </label>
      )}
    </div>
  );
}
