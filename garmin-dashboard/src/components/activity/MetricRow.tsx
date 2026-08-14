import type { MetricKey } from "@/domain/activity-chart";
import { METRIC_DEFS } from "./shared";

// ── Per-metric row: pill (toggles it on/off) + axis switch + card switch.
// Used for the four optional metrics only — Speed/Pace is always active and
// has its own inline layout (unit switch instead of an on/off pill).
export function MetricRow({ mKey, label, active, available, axisOn, cardOn, onToggleActive, onToggleAxis, onToggleCard }: {
  mKey: MetricKey; label: string; active: boolean; available: boolean;
  axisOn: boolean; cardOn: boolean;
  onToggleActive: () => void; onToggleAxis: () => void; onToggleCard: () => void;
}) {
  const color = METRIC_DEFS[mKey].color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", flexWrap: "wrap" }}>
      <button
        onClick={onToggleActive}
        disabled={!available}
        title={available ? undefined : "No data for this metric"}
        style={{
          fontSize: 11, padding: "4px 10px", borderRadius: 999, textAlign: "left",
          cursor: available ? "pointer" : "not-allowed",
          opacity: available ? 1 : 0.4,
          border: `1px solid ${active ? color : "var(--border-strong)"}`,
          background: active ? `${color}22` : "transparent",
          color: active ? color : "var(--text-secondary)",
        }}
      >
        {label}
      </button>
      {active && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={axisOn} onChange={onToggleAxis} /> Axis
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={cardOn} onChange={onToggleCard} /> Card
          </label>
        </>
      )}
    </div>
  );
}
