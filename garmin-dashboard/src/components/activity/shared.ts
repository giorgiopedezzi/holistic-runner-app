import type { MetricKey, OptionalMetricKey } from "@/domain/activity-chart";

// ── Shared constants for the activity detail view (HRA-74) ──────────────
export const axisStyle = { fill: "var(--text-muted)", fontSize: 10 };
export const gridStyle = { stroke: "var(--border)", strokeDasharray: "3 3" };
export const ttStyle   = { contentStyle: { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 } };

// ── Metric definitions ───────────────────────────────────────────────────
// Colors are the same validated-for-this-dark-surface set used in BodyTab.tsx
// (heart_rate/altitude reuse the exact accents established there; speed/
// cadence use the darker green/orange variants that clear the dark-mode
// lightness band). Power is new; the full 5-color set was re-validated
// together (validate_palette.js) before use.

// Speed's line/UI stays this app's reference green (#15965f — chosen to
// clear the dark-mode lightness band as a stroke/fill), but that same shade
// measures only ~4.15:1 against --bg-card as 9px axis tick TEXT, borderline
// for comfortable legibility. A distinct, lighter green used ONLY for the
// axis tick labels (not the line, not any other UI) fixes that without
// touching the established reference color itself.
export const SPEED_AXIS_TEXT_COLOR = "#20c17b"; // ~6.7:1 vs --bg-card

export const METRIC_DEFS: Record<MetricKey, { label: string; color: string }> = {
  speed:      { label: "Speed",      color: "#15965f" },
  heart_rate: { label: "Heart rate", color: "#e24b4a" },
  altitude_m: { label: "Altitude",   color: "#3a8ef5" },
  cadence:    { label: "Cadence",    color: "#d97706" },
  power:      { label: "Power",      color: "#a855f7" },
};
export const OPTIONAL_METRIC_ORDER: OptionalMetricKey[] = ["heart_rate", "altitude_m", "cadence", "power"];

// Speed/Pace (the one mandatory metric) is ALONE on the left — every
// optional metric (heart_rate, altitude_m, cadence, power) goes right, no
// exceptions. Earlier versions only isolated Speed from whichever single
// metric was being compared against at the time (first from all optional
// metrics generically, then just from HR once HR moved right) — but leaving
// any other optional metric sharing Speed's side meant toggling *that* one
// on could reintroduce the same "Speed shares a side with a
// dynamically-appearing axis" situation that caused it to go missing
// before. Giving Speed sole, unconditional ownership of the left side
// removes that risk under every toggle combination, not just the default
// one, while still keeping Speed and HR (the two axes visible by default)
// on opposite sides as asked.
export const AXIS_SIDE: Record<MetricKey, "left" | "right"> = {
  speed: "left", heart_rate: "right", altitude_m: "right", cadence: "right", power: "right",
};

// Same yellow gradient/cap-based scheme as pause flags — a drop (recovery)
// and a rise share one gradient keyed on magnitude only (direction shown by
// the +/− in the label, not by color), with the biggest drop rendering
// darkest, same "how much" visual language as pause duration.
export const HR_RECOVERY_COLOR_CAP = 60; // bpm — observed real deltas run ~8-55bpm
