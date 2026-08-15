import type { MetricKey } from "@/domain/activity-chart";
import { Checkbox } from "@/components/ui";
import { METRIC_DEFS } from "./shared";

export interface MetricRowState {
  active:    boolean;
  available: boolean;
  axisOn:    boolean;
  cardOn:    boolean;
}

export type MetricRowField = "active" | "axis" | "card";

// ── Per-metric row: pill (toggles it on/off) + axis switch + card switch.
// Used for the four optional metrics only — Speed/Pace is always active and
// has its own inline layout (unit switch instead of an on/off pill).
// One `state` object + one discriminated `onToggle`, not 4 boolean props +
// 3 parallel callbacks (HRA-75, architecture-avoid-boolean-props) — the
// caller still owns activeMetrics/axisVisible/showCard independently, this
// just collapses how they're threaded through one component's props.
export function MetricRow({ mKey, label, state, onToggle }: {
  mKey: MetricKey; label: string; state: MetricRowState; onToggle: (field: MetricRowField) => void;
}) {
  const { active, available, axisOn, cardOn } = state;
  const color = METRIC_DEFS[mKey].color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", flexWrap: "wrap" }}>
      <button
        onClick={() => onToggle("active")}
        disabled={!available}
        title={available ? undefined : "No data for this metric"}
        style={{
          fontSize: 11, padding: "4px 10px", borderRadius: 999, textAlign: "left",
          cursor: available ? "pointer" : "not-allowed",
          opacity: available ? 1 : 0.4,
          border: `1px solid ${active ? color : "var(--border-strong)"}`,
          background: active ? `color-mix(in srgb, ${color} 13%, transparent)` : "transparent",
          color: active ? color : "var(--text-secondary)",
        }}
      >
        {label}
      </button>
      {active && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <Checkbox size={11} checked={axisOn} onCheckedChange={() => onToggle("axis")} /> Axis
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <Checkbox size={11} checked={cardOn} onCheckedChange={() => onToggle("card")} /> Card
          </label>
        </>
      )}
    </div>
  );
}
